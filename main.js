const Engine = Matter.Engine,
      Render = Matter.Render,
      Runner = Matter.Runner,
      Bodies = Matter.Bodies,
      Composite = Matter.Composite,
      Body = Matter.Body;

let score = 0;
let isTitleMode = true;
let isPaused = false;
let isBossMode = false;
let isGameCleared = false;
let isGameOver = false;
let isWaitingForBossClearOK = false;
let isCreditsMode = false;

// 新規ステータス管理
let playMode = 'normal'; // 'normal' または 'endless'
let bossHp = 30;
let bossEncounterCount = 0; // ボスを倒した回数
let isFeverMode = false;
let lastFeverLevel = -1; // 同じレベル帯でフィーバーが連続発動するバグ防止用
let bossEntity = null;
let weakPointEntity = null;
let audioEnabled = true;
let bossDeadDropTimer = 0; // ボス戦中のペナルティタイマー
let lastFeverEndTime = 0; // フィーバー終了時刻
let feverFadeInterval = null; // フィーバーテキスト消去用タイマー
let creditsWingInterval = null; // クレジットの羽ばたき用タイマー

const CAT_DEFAULT = 0x0001;
const CAT_TARGET = 0x0002;
const CAT_GROUND = 0x0004;
const CAT_DEAD = 0x0008;

function init() {
    const engine = Engine.create();
    engine.world.gravity.y = 1;
    engine.world.gravity.x = 0;

    const GAME_WIDTH = 900;
    const GAME_HEIGHT = 1600;
    const gameContainer = document.getElementById('game-container');

    const render = Render.create({
        element: gameContainer,
        engine: engine,
        options: {
            width: GAME_WIDTH,
            height: GAME_HEIGHT,
            wireframes: false,
            background: '#000000',
            pixelRatio: window.devicePixelRatio
        }
    });

    // 物理世界の「バケツ（見えない壁と床）」を作る
    // この壁や床は「死体チキン(CAT_DEAD)」のみを塞ぎ、飛行中のターゲットはすべてスルー(落下・直進)させる
    const bucketOptions = {
        isStatic: true,
        label: 'ground',
        render: { fillStyle: 'transparent' }, 
        zIndex: 5,
        collisionFilter: { category: CAT_GROUND, mask: CAT_DEAD }
    };
    
    const ground = Bodies.rectangle(GAME_WIDTH / 2, GAME_HEIGHT + 100, GAME_WIDTH * 2, 200, bucketOptions); // 少し余裕を持たせて下に
    const leftWall = Bodies.rectangle(-25, GAME_HEIGHT / 2, 50, GAME_HEIGHT * 2, bucketOptions); // 左からこぼれないように
    const rightWall = Bodies.rectangle(GAME_WIDTH + 25, GAME_HEIGHT / 2, 50, GAME_HEIGHT * 2, bucketOptions); // 右からもこぼれないように
    Composite.add(engine.world, [ground, leftWall, rightWall]);

    // Audio elements routing
    const bgmNormal = document.getElementById('bgm_normal');
    const bgmBoss = document.getElementById('bgm_boss');
    const bgmFever = document.getElementById('bgm_fever');
    const seHit = document.getElementById('se_hit');
    const seGold = document.getElementById('se_gold');
    const seBomb = document.getElementById('se_bomb');
    const seBossHit = document.getElementById('se_boss_hit');
    const seButton = document.getElementById('se_button');
    const seClear = document.getElementById('se_clear');
    const seFever = document.getElementById('se_fever');
    
    // UI elements
    const titleScreen = document.getElementById('title-screen');
    const gameUi = document.getElementById('game-ui');
    const scoreBoard = document.getElementById('score-board');
    const dangerLine = document.getElementById('danger-line');
    const endlessNotice = document.getElementById('endless-notice');
    const feverNotice = document.getElementById('fever-notice');
    const creditsOverlay = document.getElementById('credits-overlay');
    const creditsContent = document.getElementById('credits-content');
    
    function playAudio(audioObj) {
        if (!audioEnabled || !audioObj) return;
        audioObj.currentTime = 0;
        audioObj.play().catch(e=>{});
    }

    function updateAudioButtons() {
        const icon = audioEnabled ? '🔊 ON' : '🔇 OFF';
        document.getElementById('title-audio-btn').innerText = `Sound: ${icon}`;
        document.getElementById('audio-toggle-btn').innerText = audioEnabled ? '🔊' : '🔇';
        if (!audioEnabled) { bgmNormal.pause(); bgmBoss.pause(); bgmFever.pause(); } 
        else {
            if (!isTitleMode && !isGameCleared && !isGameOver && !isPaused && !isWaitingForBossClearOK) {
                if (isBossMode) bgmBoss.play().catch(()=>{});
                else if (isFeverMode) bgmFever.play().catch(()=>{});
                else bgmNormal.play().catch(()=>{});
            }
        }
    }

    document.getElementById('title-audio-btn').addEventListener('click', (e) => { audioEnabled = !audioEnabled; updateAudioButtons(); e.currentTarget.blur(); });
    document.getElementById('audio-toggle-btn').addEventListener('click', (e) => { audioEnabled = !audioEnabled; updateAudioButtons(); e.currentTarget.blur(); });

    // --- 絵文字＆羽システム（ドット絵から復帰） ---
    function getWingPath(frame, isRightWing) {
        const baseX = isRightWing ? 70 : 50;
        const baseY = 65;
        const dir = isRightWing ? 1 : -1;
        let tipX, tipY, ctrl1X, ctrl1Y, ctrl2X, ctrl2Y;
        if (frame === 0) { tipX = baseX + 35 * dir; tipY = baseY - 40; ctrl1X = baseX + 10 * dir; ctrl1Y = baseY - 30; ctrl2X = baseX + 25 * dir; ctrl2Y = baseY - 10; } 
        else if (frame === 1 || frame === 3) { tipX = baseX + 40 * dir; tipY = baseY - 10; ctrl1X = baseX + 20 * dir; ctrl1Y = baseY - 20; ctrl2X = baseX + 30 * dir; ctrl2Y = baseY; } 
        else { tipX = baseX + 30 * dir; tipY = baseY + 20; ctrl1X = baseX + 15 * dir; ctrl1Y = baseY + 5; ctrl2X = baseX + 20 * dir; ctrl2Y = baseY + 25; }
        return `<path d="M ${baseX} ${baseY} Q ${ctrl1X} ${ctrl1Y} ${tipX} ${tipY} Q ${ctrl2X} ${ctrl2Y} ${baseX} ${baseY+10} Z" fill="#ffffff" stroke="#aaaaaa" stroke-width="2" stroke-linejoin="round"/>`;
    }

    function createTexture(frame, type) {
        const isGold = type === 'gold';
        const isBomb = type === 'bomb';
        const isBossHit = type === 'boss-hit';
        const isDead = type === 'dead';
        const isTrap = type === 'trap';
        const isRainbow = type === 'rainbow';

        const wings = (isBossHit || isDead) ? '' : getWingPath(frame, false) + getWingPath(frame, true);
        
        let emoji = '🍗';
        let filterStyle = '';
        let defs = '';

        if (isGold) { filterStyle = 'filter: sepia(1) saturate(5) hue-rotate(-20deg) brightness(1.2);'; } 
        else if (isBossHit) { 
            // 透過率を70%に修正、さらに明度(brightness)を1.2に上げて鮮やかさを強調
            filterStyle = 'filter: sepia(1) hue-rotate(-50deg) saturate(10) brightness(1.2) opacity(0.7) drop-shadow(0 0 10px red);'; 
        } 
        else if (isTrap) { filterStyle = 'filter: sepia(1) saturate(5) hue-rotate(90deg) brightness(1.1);'; } // 緑色の毒々しいチキン
        else if (isRainbow) {
            // 虹色に輝く：以前より速度を落とし、光り方も目に優しく調整 (saturateとbrightnessを抑える)
            const hue = (frame * 30) % 360; 
            filterStyle = `filter: hue-rotate(${hue}deg) saturate(3) brightness(1.1) drop-shadow(0 0 8px rgba(255,255,255,0.7));`;
        }
        else if (isDead) { filterStyle = 'opacity: 0.5;'; }

        if (isBomb) emoji = '💣';

        const fontSize = isBomb ? 60 : 65;
        const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120">${defs}${wings}<text x="60" y="65" font-size="${fontSize}" text-anchor="middle" dominant-baseline="middle" style="${filterStyle}">${emoji}</text></svg>`;
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgStr)}`;
    }

    const normalTextures = [createTexture(0, 'normal'), createTexture(1, 'normal'), createTexture(2, 'normal'), createTexture(3, 'normal')];
    const goldTextures = [createTexture(0, 'gold'), createTexture(1, 'gold'), createTexture(2, 'gold'), createTexture(3, 'gold')];
    const bombTextures = [createTexture(0, 'bomb'), createTexture(1, 'bomb'), createTexture(2, 'bomb'), createTexture(3, 'bomb')];
    const trapTextures = [createTexture(0, 'trap'), createTexture(1, 'trap'), createTexture(2, 'trap'), createTexture(3, 'trap')];
    // レインボー用：12段階の色相回転テクスチャを用意してギラギラさせる
    const rainbowTextures = [];
    for(let i=0; i<12; i++) { rainbowTextures.push(createTexture(i, 'rainbow')); }
    const bossHitTexture = createTexture(0, 'boss-hit');
    const deadChickenTexture = createTexture(0, 'dead');

    // 隠しクレジットトリガーのアイコンを設定
    const triggerEl = document.getElementById('hidden-credits-trigger');
    if (triggerEl) triggerEl.style.backgroundImage = `url("${rainbowTextures[0]}")`;

    const wpStr = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="30" fill="rgba(255, 0, 0, 0.4)" stroke="#ff0000" stroke-width="8" stroke-dasharray="10 5" /><circle cx="50" cy="50" r="10" fill="#ff0000" /></svg>`;
    const weakPointTexture = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(wpStr)}`;

    // --- 死体オブジェクトの生成 ---
    function spawnDeadChicken() {
        if (isGameCleared || isGameOver || isTitleMode) return; 

        // 壁の間(0+50 ~ GAME_WIDTH-50)でランダムに落とす
        const dropX = 50 + Math.random() * (GAME_WIDTH - 100);
        
        // 前回の1.5倍(xScale 4.5相当の超巨大)
        const deadObj = Bodies.rectangle(dropX, GAME_HEIGHT - 300, 240, 120, { 
            frictionAir: 0.1,
            friction: 0.8, // よく滑り止まるように
            restitution: 0.0, 
            label: 'dead-chicken',
            zIndex: 2, 
            collisionFilter: {
                category: CAT_DEAD,
                mask: CAT_GROUND | CAT_DEAD 
            },
            render: { sprite: { texture: deadChickenTexture, xScale: 4.5, yScale: 4.5 } }
        });
        Composite.add(engine.world, deadObj);
    }

    function spawnSingleObject(type, spawnX, spawnY) {
        let scoreValue, texArray;
        if (type === 'gold') { scoreValue = 200; texArray = goldTextures; }
        else if (type === 'bomb') { scoreValue = -500; texArray = bombTextures; }
        else if (type === 'trap') { scoreValue = 0; texArray = trapTextures; } // 毒チキンは直接減点はしない
        else if (type === 'rainbow') { scoreValue = 0; texArray = rainbowTextures; }
        else { scoreValue = 100; texArray = normalTextures; } // ノーマルチキンは100点

        const obj = Bodies.circle(spawnX, spawnY, 40, {
            frictionAir: 0,
            label: 'target',
            zIndex: type === 'trap' ? 15 : 5, // 毒チキンはボスより手前を飛ぶように設定
            collisionFilter: {
                category: CAT_TARGET,
                mask: CAT_DEFAULT // 地面や壁(CAT_GROUND)をすべてすり抜ける
            },
            render: { sprite: { texture: texArray[0], xScale: 1, yScale: 1 } }
        });

        Body.setInertia(obj, Infinity); 

        obj.objType = type;
        obj.tickCounter = Math.floor(Math.random() * 100);
        obj.frameIndex = 0;
        obj.scoreValue = scoreValue;
        obj.texArray = texArray;
        
        let speedMlt = 1.0;
        if (type === 'gold') speedMlt = 1.5;
        if (type === 'bomb') speedMlt = 0.8;
        
        // フィーバーモード時はすべてスピードアップ
        if (isFeverMode && !isTitleMode) speedMlt *= 1.3;
        if (type === 'rainbow') speedMlt *= 1.8; // 虹色チキンは速い！

        // 斜め左下（After Darkオマージュ軌道）へゆっくりと漂うクリックしやすい速度
        obj.baseVy = (0.5 + Math.random() * 1.0) * speedMlt; 
        obj.baseVx = (-1.0 - Math.random() * 1.0) * speedMlt; 
        Body.setVelocity(obj, { x: obj.baseVx, y: obj.baseVy });

        Composite.add(engine.world, obj);
    }

    function spawnEvent() {
        if (isTitleMode || isBossMode) return; // タイトル画面やボス戦中は出撃しない

        // UIボタン（右上）を避けるため、出現位置の高さを少し下(300px〜)からスタートさせる
        const x = GAME_WIDTH + 50 + Math.random() * 200;
        const y = 300 + Math.random() * (GAME_HEIGHT / 2.5);

        const rand = Math.random();
        
        if (isFeverMode) {
            // フィーバーモード：爆弾なし、金チキン出現率25%
            if (rand < 0.25) spawnSingleObject('gold', x, y);
            else spawnSingleObject('normal', x, y);
        } else {
            // 通常モード
            const now = Date.now();
            const canSpawnRainbow = (now - lastFeverEndTime > 20000);
            if (rand < 0.008 && canSpawnRainbow) { spawnSingleObject('rainbow', x, y); } 
            else if (rand < 0.07) { spawnSingleObject('gold', x, y); } 
            else if (rand < 0.22) {
                spawnSingleObject('bomb', x, y);
                spawnSingleObject('normal', x + 150 + Math.random()*50, y - 50 - Math.random()*50);
            } else { spawnSingleObject('normal', x, y); }
        }
    }

    const bossUi = document.getElementById('boss-ui');
    const hpBarFill = document.getElementById('hp-bar-fill');

    function relocateWeakPoint() {
        if (!weakPointEntity) return;
        // 巨大チキンのテクスチャ（本体部分）に確実に収まるよう、半径を厳しめに制限（±160px以内）
        weakPointEntity.offsetX = (Math.random() - 0.5) * 200;
        weakPointEntity.offsetY = (Math.random() - 0.5) * 200;
    }

    function spawnBoss() {
        if (isBossMode) return;

        // ボス出現時は即座にすべてのターゲットを一掃する
        const currentTargets = Composite.allBodies(engine.world);
        for (let b of currentTargets) {
            if (b.label === 'target') {
                Composite.remove(engine.world, b);
            }
        }

        isBossMode = true;
        
        // ボス出現でフィーバーは強制終了
        if (isFeverMode) {
            isFeverMode = false;
            bgmFever.pause();
            feverNotice.classList.add('hidden');
            feverNotice.style.opacity = 0;
        }
        
        bossDeadDropTimer = 0; // ペナルティタイマーリセット

        if (feverFadeInterval) { clearInterval(feverFadeInterval); feverFadeInterval = null; }
        
        const bossNameEl = document.querySelector('.boss-name');
        if (playMode === 'endless') {
            bossNameEl.innerText = `GIANT CHICKEN Lv.${bossEncounterCount + 1}`;
        } else {
            bossNameEl.innerText = 'GIANT CHICKEN';
        }

        bossUi.classList.remove('hidden');
        
        // エンドレス毎のHP加算 (初期50点、以降1体倒すごとに+20点)
        const maxHp = 50 + (bossEncounterCount * 20);
        bossHp = maxHp;
        bossEntity = bossEntity || {}; // 既存保持
        bossEntity.maxHp = maxHp;
        hpBarFill.style.width = '100%';
        
        bgmNormal.pause();
        
        // 通常プレイ（ノーマルクリアのみ）なら背景アニメを止める。エンドレスなら維持したままボスBGMへ
        if (playMode !== 'endless') setBackgroundAnimation(false);
        playAudio(bgmBoss);

        bossEntity = Bodies.circle(GAME_WIDTH / 2, -300, 240, { 
            isStatic: true, isSensor: true, label: 'boss', zIndex: 10, collisionFilter: { mask: 0 }, 
            render: { sprite: { texture: normalTextures[0], xScale: 6.0, yScale: 6.0 } }
        });
        bossEntity.tickCounter = 0;
        bossEntity.frameIndex = 0;
        bossEntity.texArray = normalTextures;
        bossEntity.hitTimer = 0; 
        bossEntity.baseX = GAME_WIDTH / 2;
        bossEntity.baseY = -300;
        bossEntity.maxHp = maxHp; // HPゲージ計算のために記録

        weakPointEntity = Bodies.circle(GAME_WIDTH / 2, -300, 50, {
            isStatic: true, isSensor: true, label: 'weak-point', zIndex: 11,
            render: { sprite: { texture: weakPointTexture, xScale: 1.2, yScale: 1.2 } }
        });

        relocateWeakPoint();
        Composite.add(engine.world, [bossEntity, weakPointEntity]);
    }

    const DangerHeight = GAME_HEIGHT * 0.5; // ゲームオーバーラインを50%に変更

    const clearOverlay = document.getElementById('clear-overlay');
    const endlessBreakOverlay = document.getElementById('endless-break-overlay');

    let bgAnimInterval = null;
    const titleBackground = document.getElementById('title-background');

    // titleAnimIntervalを汎用的名前に変更して使い回す
    function setBackgroundAnimation(enabled) {
        if (bgAnimInterval) {
            clearInterval(bgAnimInterval);
            bgAnimInterval = null;
        }
        
        if (!enabled) {
            titleBackground.innerHTML = ''; // クリア
            return;
        }
        
        titleBackground.innerHTML = '';
        
        // 最初の数羽を即座に出す (約20匹に調整)
        for(let i=0; i<20; i++) spawnBackgroundChicken(true);
        
        bgAnimInterval = setInterval(() => {
            // タイトル、ボス、またはクレジットモード以外なら止める
            if (!isTitleMode && !isBossMode && !isCreditsMode) {
                setBackgroundAnimation(false);
                return;
            }
            spawnBackgroundChicken(false);
        }, 250); // 元の200msから250msへ(湧き頻度を20%削減)
    }

    function spawnBackgroundChicken(isInit) {
        if (!isTitleMode && !isBossMode && !isCreditsMode) return;
        const rand = Math.random();
        let type = 'normal';
        let texArray = normalTextures;
        let speedMlt = 1.0;
        
        if (rand < 0.05) { type = 'gold'; texArray = goldTextures; speedMlt = 1.5; }
        else if (rand < 0.20) { type = 'bomb'; texArray = bombTextures; speedMlt = 0.8; }

        const el = document.createElement('img');
        el.src = texArray[0];
        el.style.position = 'absolute';
        // HTMLのScaleに合わせて比率を調整
        el.style.width = type === 'bomb' ? '90px' : '100px'; 
        el.style.height = type === 'bomb' ? '90px' : '100px';

        // 初期スポーンならランダムなX座標、それ以外は右辺か上辺から飛んでくるようにする
        let currentX, currentY;
        if (isInit) {
            currentX = Math.random() * window.innerWidth;
            // 初期配置でも下部20%にはあまり配置しない
            currentY = -200 + Math.random() * (window.innerHeight * 0.8 + 200);
        } else {
            if (Math.random() < 0.5) {
                // 画面右辺の外側から (画面下20%からは出ないように、上限を調整)
                currentX = window.innerWidth + 50;
                currentY = -400 + Math.random() * (window.innerHeight * 0.8 + 400);
            } else {
                // 画面上辺（天井）の外側から
                currentX = Math.random() * (window.innerWidth + 200);
                currentY = -150 - Math.random() * 400;
            }
        }
        
        el.style.transform = `translate(${currentX}px, ${currentY}px)`;
        titleBackground.appendChild(el);

        // ゲーム本編と全く同じ初速・挙動を計算
        let baseVy = (0.5 + Math.random() * 1.0) * speedMlt; 
        let baseVx = (-1.0 - Math.random() * 1.0) * speedMlt;
        let tick = Math.floor(Math.random() * 100);
        let frame = 0;

        function updateAnim() {
            if ((!isTitleMode && !isCreditsMode) || !document.body.contains(el)) return;
            tick++;
            
            // 羽ばたきアニメーション
            if (tick % 8 === 0) {
                frame = (frame + 1) % 4;
                el.src = texArray[frame];
            }

            // フワフワ挙動と斜め移動
            const fluctuateY = Math.sin(tick * 0.1) * 1.0;
            currentX += baseVx;
            currentY += (baseVy + fluctuateY);

            el.style.transform = `translate(${currentX}px, ${currentY}px)`;

            // 左端か下端を越えたら消滅
            if (currentX < -200 || currentY > window.innerHeight + 200) {
                el.remove();
            } else {
                requestAnimationFrame(updateAnim);
            }
        }
        
        requestAnimationFrame(updateAnim);
    }

    function startPlay(mode) {
        playAudio(seButton);
        isTitleMode = false;
        isGameOver = false;
        isGameCleared = false;
        isPaused = false;
        isWaitingForBossClearOK = false;
        pauseBtn.disabled = false;
        pauseBtn.innerText = '⏸️';
        if (feverFadeInterval) { clearInterval(feverFadeInterval); feverFadeInterval = null; }
        document.getElementById('pause-overlay').classList.add('hidden');
        document.getElementById('gameover-overlay').classList.add('hidden');
        document.getElementById('clear-overlay').classList.add('hidden');
        engine.timing.timeScale = 1;

        setBackgroundAnimation(false); // アクションゲーム開始時は背景を完全に空にする

        playMode = mode;
        bossEncounterCount = 0;
        isFeverMode = false;
        lastFeverLevel = -1;
        isBossMode = false;
        titleScreen.classList.add('hidden');
        gameUi.classList.remove('hidden');
        feverNotice.classList.add('hidden');
        
        const bodies = Composite.allBodies(engine.world);
        for (let body of bodies) {
            if (body.label === 'target' || body.label === 'dead-chicken' || body.label === 'boss' || body.label === 'weak-point') {
                Composite.remove(engine.world, body);
            }
        }
        bossUi.classList.add('hidden');
        bossEntity = null;
        weakPointEntity = null;
        feverNotice.classList.add('hidden');
        feverNotice.style.opacity = 0;
        
        bgmNormal.pause();
        bgmBoss.pause();
        bgmFever.pause();

        score = 0;
        scoreBoard.innerText = `Score：${score}`;
        lastSpawnTime = Date.now();
        playAudio(bgmNormal); // Play BGM ONLY when actually starting
        updateAudioButtons();
    }

    document.getElementById('start-normal-btn').addEventListener('click', () => startPlay('normal'));
    document.getElementById('start-endless-btn').addEventListener('click', () => startPlay('endless'));

    function showCredits() {
        if (isCreditsMode) return;
        isCreditsMode = true;
        
        // すべてのオーバーレイとUIを隠す
        titleScreen.classList.add('hidden');
        gameUi.classList.add('hidden');
        document.getElementById('boss-ui').classList.add('hidden');
        dangerLine.classList.add('hidden');
        document.getElementById('clear-overlay').classList.add('hidden');
        document.getElementById('gameover-overlay').classList.add('hidden');
        document.getElementById('pause-overlay').classList.add('hidden');
        document.getElementById('endless-break-overlay').classList.add('hidden');
        
        creditsOverlay.classList.remove('hidden');

        // 物理オブジェクト（チキンや死体）をすべて消去
        const currentBodies = Composite.allBodies(engine.world);
        for (let b of currentBodies) {
            if (b.label === 'target' || b.label === 'dead-chicken' || b.label === 'boss' || b.label === 'weak-point') {
                Composite.remove(engine.world, b);
            }
        }
        
        // アイコンの注入
        document.getElementById('icon-normal').style.backgroundImage = `url("${normalTextures[0]}")`;
        document.getElementById('icon-gold').style.backgroundImage = `url("${goldTextures[0]}")`;
        document.getElementById('icon-rainbow').style.backgroundImage = `url("${rainbowTextures[0]}")`;
        document.getElementById('icon-bomb').style.backgroundImage = `url("${bombTextures[0]}")`;
        document.getElementById('icon-trap').style.backgroundImage = `url("${trapTextures[0]}")`;
        document.getElementById('icon-dead').style.backgroundImage = `url("${deadChickenTexture}")`;
        document.getElementById('icon-dead').style.transform = 'scale(1.5)'; // ジャイアントと同じ大きさ
        document.getElementById('icon-boss').style.backgroundImage = `url("${normalTextures[0]}")`;
        document.getElementById('icon-boss').style.transform = 'scale(1.5)'; // ボスっぽく大きく

        // アニメーションをリセット
        creditsContent.style.animation = 'none';
        creditsContent.offsetHeight; // reflow
        creditsContent.style.animation = 'credits-scroll 50s linear forwards';

        // 羽ばたきアニメーションの開始
        if (creditsWingInterval) clearInterval(creditsWingInterval);
        let frame = 0;
        creditsWingInterval = setInterval(() => {
            frame = (frame + 1) % 4;
            const rbFrame = (frame * 3) % 12; // レインボーは12段階なので調整
            document.getElementById('icon-normal').style.backgroundImage = `url("${normalTextures[frame]}")`;
            document.getElementById('icon-gold').style.backgroundImage = `url("${goldTextures[frame]}")`;
            document.getElementById('icon-rainbow').style.backgroundImage = `url("${rainbowTextures[rbFrame]}")`;
            document.getElementById('icon-bomb').style.backgroundImage = `url("${bombTextures[frame]}")`;
            document.getElementById('icon-trap').style.backgroundImage = `url("${trapTextures[frame]}")`;
            document.getElementById('icon-boss').style.backgroundImage = `url("${normalTextures[frame]}")`;
        }, 120);

        // BGM再生 (冒頭の空白を考慮して少し遅らせる)
        if (audioEnabled) {
            bgmNormal.volume = 1.0;
            bgmNormal.currentTime = 0;
            setTimeout(() => {
                if (isCreditsMode) bgmNormal.play().catch(e=>{});
            }, 300);
        }
        
        // 背景アニメーションも（もし止まってたら）再開
        setBackgroundAnimation(true);
    }

    function hideCredits(isAuto = false) {
        if (!isCreditsMode) return;
        
        if (creditsWingInterval) {
            clearInterval(creditsWingInterval);
            creditsWingInterval = null;
        }

        if (isAuto) {
            // オートリターンの場合はフェード -> 待ち -> 戻る
            if (audioEnabled && !bgmNormal.paused) {
                let vol = 1.0;
                const fadeInterval = setInterval(() => {
                    vol -= 0.02; // ゆっくりフェード
                    if (vol <= 0) {
                        clearInterval(fadeInterval);
                        bgmNormal.pause();
                        bgmNormal.volume = 1.0;
                        
                        // BGMが消えた後に一拍おいてからタイトルへ
                        setTimeout(() => {
                            isCreditsMode = false;
                            creditsOverlay.classList.add('hidden');
                            gameUi.classList.add('hidden'); // UIを確実に隠す
                            titleScreen.classList.remove('hidden');
                            isTitleMode = true; // タイトルモードへ復帰
                            setBackgroundAnimation(true);
                        }, 800);
                    } else {
                        bgmNormal.volume = vol;
                    }
                }, 30);
            } else {
                isCreditsMode = false;
                creditsOverlay.classList.add('hidden');
                titleScreen.classList.remove('hidden');
                isTitleMode = true;
                setBackgroundAnimation(true);
            }
        } else {
            // クリックなどの手動操作は即座にタイトルへ
            isCreditsMode = false;
            if (audioEnabled) {
                bgmNormal.pause();
                bgmNormal.volume = 1.0;
            }
            creditsOverlay.classList.add('hidden');
            gameUi.classList.add('hidden');
            titleScreen.classList.remove('hidden');
            isTitleMode = true;
            setBackgroundAnimation(true);
            playAudio(seButton);
        }
    }

    creditsOverlay.addEventListener('click', () => hideCredits(false));
    creditsContent.addEventListener('animationend', () => hideCredits(true));
    
    // 隠しトリガーの初期化
    const creditsTrigger = document.getElementById('hidden-credits-trigger');
    creditsTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        showCredits();
    });

    document.getElementById('endless-resume-btn').addEventListener('click', () => {
        playAudio(seButton);
        isWaitingForBossClearOK = false;
        pauseBtn.disabled = false;
        endlessBreakOverlay.classList.add('hidden');
        playAudio(bgmNormal);
        engine.timing.timeScale = 1;
        lastSpawnTime = Date.now(); // リジュームした瞬間から湧き開始
    });

    function startFeverMode() {
        if (isFeverMode || isBossMode || isTitleMode) return;
        if (feverFadeInterval) { clearInterval(feverFadeInterval); feverFadeInterval = null; }

        isFeverMode = true;
        feverNotice.classList.remove('hidden');
        feverNotice.style.opacity = 1;
        playAudio(seFever);
        bgmNormal.pause();
        bgmBoss.pause();
        playAudio(bgmFever);

        // フィーバー突入時に虹チキンと爆弾を一掃（通常と金は残す）
        const currentAll = Composite.allBodies(engine.world);
        for (let b of currentAll) {
            if (b.label === 'target' && (b.objType === 'bomb' || b.objType === 'rainbow')) {
                // プレイヤーのクリックではないため、爆発ではなく小さな煙エフェクト（normal）でひっそり消す
                playEffect(b.position.x, b.position.y, 'normal');
                Composite.remove(engine.world, b);
            }
        }

        // 20秒後に終了
        setTimeout(() => {
            if (!isFeverMode) return; // すでにボス等で終了している場合は何もしない
            isFeverMode = false;

            // フィーバー終了時に残ったターゲットを一掃
            const resetBodies = Composite.allBodies(engine.world);
            for (let b of resetBodies) {
                if (b.label === 'target') {
                    Composite.remove(engine.world, b);
                }
            }

            if (!isBossMode && !isTitleMode && !isGameOver && !isGameCleared && !isPaused) {
                bgmFever.pause();
                playAudio(bgmNormal);
            }

            let op = 1;
            feverFadeInterval = setInterval(() => {
                op -= 0.05; feverNotice.style.opacity = op;
                if (op <= 0) { 
                    clearInterval(feverFadeInterval); 
                    feverFadeInterval = null;
                    feverNotice.classList.add('hidden'); 
                    lastFeverEndTime = Date.now(); // フィーバー終了時刻を記録
                }
            }, 50);
        }, 20000);
    }

    document.querySelectorAll('.retry-btn').forEach(btn => {
        btn.addEventListener('click', () => { 
            startPlay(playMode);
        });
    });

    document.querySelectorAll('.back-to-title-btn').forEach(btn => {
        btn.addEventListener('click', () => { 
            playAudio(seButton); 
            setTimeout(() => location.reload(), 100); 
        });
    });

    Matter.Events.on(engine, 'beforeUpdate', () => {
        // ポーズ中、ゲーム終了時、またはボス撃破後の待機中(timeScale=0)は一切の更新（湧き処理含む）を停止する
        if (isPaused || isGameOver || isGameCleared || engine.timing.timeScale === 0) return;
        const now = Date.now();
        
        engine.world.bodies.sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

        // エンドレスのモード：10000点ごとに必ずボスが出現するように変更
        if (playMode === 'endless' && !isTitleMode && !isBossMode) {
            const currentLevel = Math.floor(score / 10000); 
            if (currentLevel > bossEncounterCount) {
                // Boss! (フィーバーは自動では発生せず、虹チキン獲得時のみに)
                spawnBoss();
            }
        } else if (playMode === 'normal' && !isTitleMode && !isBossMode && score >= 10000) {
            spawnBoss();
        }

        if (!isBossMode) {
            let interval = isFeverMode ? 700 : 1000;
            
            if (now - lastSpawnTime > interval) {
                // ボス撃破直後は難易度を2000相当(以前の3000からさらに2割削減)に落とし、次の10000に向けて緩勾配で増やす
                let difficultyScore = score;
                if (playMode === 'endless' && score > 10000) {
                    difficultyScore = 2000 + ((score % 10000) / 10000) * 8000;
                }
                const effectiveScore = Math.min(difficultyScore, 10000);
                
                // 出現頻度の計算も少し緩やかに (3500 -> 4000)
                let spawnCount = Math.floor(effectiveScore / 4000) + 1;
                if (isFeverMode) spawnCount = 4; // フィーバー中はどっさり
                const maxSpawn = Math.min(5, spawnCount);
                for(let i = 0; i < maxSpawn; i++) { spawnEvent(); }
                lastSpawnTime = now;
            }
        } else {
            // ボス戦中のペナルティ（10秒 = 600フレームごとに死体落下）
            bossDeadDropTimer++;
            if (bossDeadDropTimer >= 600) {
                spawnDeadChicken();
                bossDeadDropTimer = 0;
            }

            // ボス戦中の毒チキンの出現頻度を討伐回数に応じて段階的に加速
            const baseInterval = Math.max(400, 1800 - (bossEncounterCount * 250)); 
            const randomVar = Math.max(200, 3000 - (bossEncounterCount * 600)); 
            if (now - lastSpawnTime > baseInterval + Math.random() * randomVar) { 
                // 右端から湧かせ、下寄りにも出るようにする
                let x = GAME_WIDTH + 100;
                let y = 300 + Math.random() * (GAME_HEIGHT * 0.5);
                spawnSingleObject('trap', x, y); 
                
                // 討伐回数に応じて2羽出る確率を大幅アップ (最大90%)
                const doubleChance = Math.min(0.9, 0.2 + (bossEncounterCount * 0.15));
                if (Math.random() < doubleChance) {
                    spawnSingleObject('trap', x + 150, y + (Math.random()-0.5)*200);
                }
                lastSpawnTime = now; 
            }
        }

        let highestPileY = GAME_HEIGHT;
        const bodies = Composite.allBodies(engine.world);

        for (let body of bodies) {
            if (body.label === 'target') {
                body.tickCounter++;
                
                // アニメーション更新
                const animSpeed = body.objType === 'rainbow' ? 4 : 8; // 虹チキンは少し速度を落として目に優しく (2F→4F)
                if (body.tickCounter % animSpeed === 0) {
                    if (body.objType === 'rainbow') {
                        body.frameIndex = (body.frameIndex + 1) % body.texArray.length;
                    } else {
                        body.frameIndex = (body.frameIndex + 1) % 4;
                    }
                    body.render.sprite.texture = body.texArray[body.frameIndex];
                }
                const fluctuateY = Math.sin(body.tickCounter * 0.1) * 1.0;
                Body.applyForce(body, body.position, { x: 0, y: -engine.world.gravity.y * engine.world.gravity.scale * body.mass });
                
                // 初速Vxを使って強制的に横移動させる(エンジンの初期化による失速を防ぐため)
                Body.setVelocity(body, { x: body.baseVx, y: body.baseVy + fluctuateY });

                if (body.position.x < -150 || body.position.y > GAME_HEIGHT + 100) {
                    // 確実に画面左端または下端を越えて逃げきられた場合のみミスペナルティ
                    if (body.objType === 'normal' && !isBossMode && !isTitleMode && !isFeverMode) {
                        spawnDeadChicken(); 
                    }
                    Composite.remove(engine.world, body);
                } else if (body.position.x > GAME_WIDTH + 400 || body.position.y < -400) {
                    // 最初から画面外へ飛び去る異常な動きをしたら掃除
                    Composite.remove(engine.world, body);
                }
            }
            else if (body.label === 'dead-chicken') {
                if (body.position.y < highestPileY && body.velocity.y < 0.1) highestPileY = body.position.y;
            }
            else if (body.label === 'boss') {
                body.tickCounter++;
                if (body.hitTimer > 0) { body.hitTimer--; body.render.sprite.texture = bossHitTexture; } 
                else { if (body.tickCounter % 15 === 0) { body.frameIndex = (body.frameIndex + 1) % 4; } body.render.sprite.texture = body.texArray[body.frameIndex]; }
                
                const targetY = GAME_HEIGHT / 3;
                body.baseY = body.baseY + (targetY - body.baseY) * 0.02;
                const offX = Math.sin(body.tickCounter * 0.015) * 250.0; 
                const offY = Math.cos(body.tickCounter * 0.02) * 100.0; 
                
                // 被弾時の揺れ（シェイク）演出を追加
                let shakeX = 0, shakeY = 0;
                if (body.hitTimer > 0) {
                    shakeX = (Math.random() - 0.5) * 45; // ダメージを受けた衝撃を表現
                    shakeY = (Math.random() - 0.5) * 45;
                }
                Body.setPosition(body, { x: body.baseX + offX + shakeX, y: body.baseY + offY + shakeY });
            }
            else if (body.label === 'weak-point' && bossEntity) {
                Body.setPosition(body, { x: bossEntity.position.x + (body.offsetX || 0), y: bossEntity.position.y + (body.offsetY || 0) });
            }
        }

        if (!isTitleMode) {
            if (highestPileY < DangerHeight + 150) {
                dangerLine.classList.remove('hidden');
            } else {
                dangerLine.classList.add('hidden');
            }

            if (highestPileY < DangerHeight) {
                isGameOver = true;
                dangerLine.classList.add('hidden');
                bgmNormal.pause(); bgmBoss.pause();
                
                setTimeout(() => {
                    document.getElementById('final-score-text').innerText = `Result Score：${score}\nToo many chickens!`;
                    document.getElementById('gameover-overlay').classList.remove('hidden');
                    engine.timing.timeScale = 0;
                }, 1500);
            }
        } else {
            dangerLine.classList.add('hidden');
        }
    });

    const effectsContainer = document.getElementById('effects-container');
    function playEffect(x, y, type) {
        const bounds = render.canvas.getBoundingClientRect();
        const scaleX = bounds.width / GAME_WIDTH;
        const scaleY = bounds.height / GAME_HEIGHT;
        const el = document.createElement('div');
        el.className = 'effect';
        el.style.left = `${x * scaleX}px`;
        el.style.top = `${y * scaleY}px`;
        
        if (type === 'normal') { el.innerText = '💨'; el.classList.add('effect-normal'); }
        else if (type === 'bomb') { el.innerText = '💥'; el.classList.add('effect-bomb'); }
        else if (type === 'gold') { el.innerText = '✨'; el.classList.add('effect-gold'); }
        else if (type === 'rainbow') { el.innerText = '🌈'; el.classList.add('effect-gold'); }
        else if (type === 'trap') { el.innerText = '💀'; el.classList.add('effect-normal'); } 
        
        effectsContainer.appendChild(el);
        el.addEventListener('animationend', () => el.remove());
    }

    function playScoreEffect(x, y, value) {
        if (value === 0) return;
        const bounds = render.canvas.getBoundingClientRect();
        const scaleX = bounds.width / GAME_WIDTH;
        const scaleY = bounds.height / GAME_HEIGHT;
        
        const el = document.createElement('div');
        
        let colorClass = 'score-white';
        if (value < 0) {
            colorClass = 'score-minus';
        } else if (isFeverMode) {
            colorClass = 'score-yellow';
        }

        el.className = `score-effect ${colorClass}`;
        el.style.left = `${x * scaleX}px`;
        el.style.top = `${y * scaleY}px`;
        el.innerText = (value > 0 ? '+' : '') + value;
        
        effectsContainer.appendChild(el);
        setTimeout(() => el.remove(), 1000); // アニメーション後に除去
    }

    const pauseBtn = document.getElementById('pause-btn');

    function togglePause() {
        if (isGameOver || isTitleMode || isGameCleared || isWaitingForBossClearOK) return; 
        isPaused = !isPaused;
        if (isPaused) {
            engine.timing.timeScale = 0; 
            document.getElementById('pause-overlay').classList.remove('hidden');
            pauseBtn.innerText = '▶️';
            bgmNormal.pause(); bgmBoss.pause(); bgmFever.pause();
        } else {
            engine.timing.timeScale = 1; 
            document.getElementById('pause-overlay').classList.add('hidden');
            pauseBtn.innerText = '⏸️';
            updateAudioButtons(); 
        }
    }

    pauseBtn.addEventListener('click', togglePause);
    document.getElementById('resume-btn').addEventListener('click', togglePause);

    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space') { 
            if (isWaitingForBossClearOK) return;
            e.preventDefault(); 
            togglePause(); 
        }
        // デバッグコマンド
        if (e.key === '9' && isTitleMode && !isCreditsMode) {
            showCredits();
        } else if (isCreditsMode) {
            hideCredits();
            return;
        }

        if (e.code === 'KeyD' && !isTitleMode) { score += 9950; scoreBoard.innerText = `Score：${score}`; }
        // フィーバーテスト用
        if (e.code === 'KeyF' && !isTitleMode) { score = 19950; scoreBoard.innerText = `Score：${score}`; }
        // レインボーチキン召喚
        if (e.code === 'KeyR' && !isTitleMode) { 
            spawnSingleObject('rainbow', GAME_WIDTH + 50, 400 + Math.random()*400); 
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden && !isPaused && !isGameOver && !isTitleMode && !isGameCleared) togglePause();
    });

    render.canvas.addEventListener('pointerdown', function(event) {
        if (isPaused || isGameOver || isTitleMode || isGameCleared) return; 

        event.preventDefault();
        const bounds = render.canvas.getBoundingClientRect();
        const scaleX = render.options.width / bounds.width;
        const scaleY = render.options.height / bounds.height;
        const mousePoint = { x: (event.clientX - bounds.left) * scaleX, y: (event.clientY - bounds.top) * scaleY };

        const bodies = Composite.allBodies(engine.world);
        let targetBody = null;
        for(let i = bodies.length - 1; i >= 0; i--) {
            if (Matter.Bounds.contains(bodies[i].bounds, mousePoint) && Matter.Vertices.contains(bodies[i].vertices, mousePoint)) {
                targetBody = bodies[i]; break; 
            }
        }

        if (targetBody) {
            if (targetBody.label === 'target') {
                if(targetBody.objType === 'gold') playAudio(seGold);
                else if(targetBody.objType === 'bomb' || targetBody.objType === 'trap') playAudio(seBomb);
                else if(targetBody.objType === 'rainbow') playAudio(seGold);
                else playAudio(seHit);

                // 虹チキンヒット時は専用のエフェクトを表示
                const effectType = targetBody.objType;
                playEffect(targetBody.position.x, targetBody.position.y, effectType);
                
                const clickedType = targetBody.objType;
                const baseValue = targetBody.scoreValue;
                // フィーバー中はスコア1.5倍（正負に関わらず）
                let finalValue = baseValue;
                if (isFeverMode && clickedType !== 'rainbow') {
                    finalValue = Math.floor(baseValue * 1.5);
                }

                Composite.remove(engine.world, targetBody);
                score += finalValue;
                if (score < 0) score = 0;
                scoreBoard.innerText = `Score：${score}`;

                // スコアの浮遊テキストを表示
                playScoreEffect(targetBody.position.x, targetBody.position.y, finalValue);
                
                // 特殊処理
                if (clickedType === 'trap') {
                    spawnDeadChicken();
                } else if (clickedType === 'rainbow') {
                    startFeverMode();
                }
            }
            else if (targetBody.label === 'weak-point') {
                playAudio(seBossHit);
                // 煙エフェクトを削除し、ボスの赤色発光のみにする
                bossHp--;
                bossEntity.hitTimer = 10; 
                hpBarFill.style.width = `${(bossHp / bossEntity.maxHp) * 100}%`;
                
                if (bossHp <= 0) {
                    // トドメの瞬間の演出：ボス消滅と爆発のみ
                    playEffect(bossEntity.position.x, bossEntity.position.y, 'bomb'); 
                    Composite.remove(engine.world, bossEntity);
                    Composite.remove(engine.world, weakPointEntity);
                    bossUi.classList.add('hidden');
                    bgmBoss.pause();
                    
                    // 1.5秒待機してからファンファーレとリザルトを表示
                    setTimeout(() => {
                        playAudio(seClear);
                        isBossMode = false; // ここでボス戦モード終了

                        if (playMode === 'normal') {
                            isGameCleared = true;
                            isWaitingForBossClearOK = true;
                            pauseBtn.disabled = true;
                            clearOverlay.classList.remove('hidden');
                            engine.timing.timeScale = 0; 
                        } else {
                            // ▼盤面リセット：ボスを倒したら、飛んでいるチキンとバクダンを一旦すべて消去して仕切り直す！
                            const currentBodies = Composite.allBodies(engine.world);
                            for (let b of currentBodies) {
                                if (b.label === 'target') {
                                    Composite.remove(engine.world, b);
                                }
                            }
                            
                            // ボス中に出していた背景DOMを全消去
                            setBackgroundAnimation(false);

                            // エンドレスモードの場合は直ちにスコア・カウントを加算して無限湧きバグを防ぐ
                            score += 1000;
                            scoreBoard.innerText = `Score：${score}`;
                            bossEncounterCount++;
                            
                            // 休憩(Break)画面を表示して一時停止
                            isWaitingForBossClearOK = true;
                            pauseBtn.disabled = true;
                            endlessBreakOverlay.classList.remove('hidden');
                            engine.timing.timeScale = 0; 
                        }
                    }, 1500);
                } else if (bossHp % 5 === 0) { relocateWeakPoint(); }
            }
        }
    });

    setBackgroundAnimation(true);

    Render.run(render);
    const runner = Runner.create();
    Runner.run(runner, engine);
}

window.addEventListener('load', init);
