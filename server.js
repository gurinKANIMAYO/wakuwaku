const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// 静的ファイルの提供
app.use(express.static('public'));

// ゲーム状態
const gameState = {
    players: {},
    obstacles: [],
    platforms: [],
    coins: [],
    worldWidth: 10000,
    chunkSize: 800
};

// 障害物の種類
const obstacleTypes = [
    { type: 'spike', width: 40, height: 40, color: '#ff4444' },
    { type: 'moving', width: 60, height: 20, color: '#ff8800' },
    { type: 'hole', width: 80, height: 200, color: '#000000' },
    { type: 'wall', width: 30, height: 120, color: '#666666' }
];

// プラットフォームの種類
const platformTypes = [
    { width: 100, height: 20, color: '#4CAF50' },
    { width: 150, height: 20, color: '#2196F3' },
    { width: 80, height: 20, color: '#FF9800' }
];

// ランダムコース生成
function generateChunk(chunkX) {
    const chunk = {
        platforms: [],
        obstacles: [],
        coins: []
    };

    const numPlatforms = Math.floor(Math.random() * 8) + 4;
    const numObstacles = Math.floor(Math.random() * 6) + 2;
    const numCoins = Math.floor(Math.random() * 10) + 5;

    // プラットフォーム生成
    for (let i = 0; i < numPlatforms; i++) {
        const platformType = platformTypes[Math.floor(Math.random() * platformTypes.length)];
        const platform = {
            id: `platform_${chunkX}_${i}`,
            x: chunkX + Math.random() * gameState.chunkSize,
            y: 200 + Math.random() * 300,
            width: platformType.width,
            height: platformType.height,
            color: platformType.color,
            type: 'platform'
        };
        chunk.platforms.push(platform);
    }

    // 障害物生成
    for (let i = 0; i < numObstacles; i++) {
        const obstacleType = obstacleTypes[Math.floor(Math.random() * obstacleTypes.length)];
        const obstacle = {
            id: `obstacle_${chunkX}_${i}`,
            x: chunkX + Math.random() * gameState.chunkSize,
            y: obstacleType.type === 'hole' ? 400 : 300 + Math.random() * 100,
            width: obstacleType.width,
            height: obstacleType.height,
            color: obstacleType.color,
            type: obstacleType.type,
            moveSpeed: obstacleType.type === 'moving' ? (Math.random() * 2 + 1) * (Math.random() > 0.5 ? 1 : -1) : 0
        };
        chunk.obstacles.push(obstacle);
    }

    // コイン生成
    for (let i = 0; i < numCoins; i++) {
        const coin = {
            id: `coin_${chunkX}_${i}`,
            x: chunkX + Math.random() * gameState.chunkSize,
            y: 150 + Math.random() * 250,
            width: 20,
            height: 20,
            color: '#FFD700',
            type: 'coin',
            collected: false
        };
        chunk.coins.push(coin);
    }

    return chunk;
}

// 初期チャンク生成
for (let i = 0; i < 20; i++) {
    const chunk = generateChunk(i * gameState.chunkSize);
    gameState.platforms.push(...chunk.platforms);
    gameState.obstacles.push(...chunk.obstacles);
    gameState.coins.push(...chunk.coins);
}

// 衝突判定ヘルパー関数
function checkCollision(rect1, rect2) {
    return rect1.x < rect2.x + rect2.width &&
           rect1.x + rect1.width > rect2.x &&
           rect1.y < rect2.y + rect2.height &&
           rect1.y + rect1.height > rect2.y;
}

// より精密な衝突判定（前の位置も考慮）
function checkCollisionWithPrevious(current, previous, target) {
    return {
        colliding: checkCollision(current, target),
        fromTop: previous.y + previous.height <= target.y && current.vy > 0,
        fromBottom: previous.y >= target.y + target.height && current.vy < 0,
        fromLeft: previous.x + previous.width <= target.x && current.vx > 0,
        fromRight: previous.x >= target.x + target.width && current.vx < 0
    };
}

// プレイヤークラス
class Player {
    constructor(id, name) {
        this.id = id;
        this.name = name;
        this.x = 100;
        this.y = 400;
        this.vx = 0;
        this.vy = 0;
        this.width = 30;
        this.height = 30;
        this.onGround = false;
        this.score = 0;
        this.color = `hsl(${Math.random() * 360}, 70%, 50%)`;
        this.health = 100;
        this.invulnerable = 0; // 無敵時間
    }

    update() {
        // 前のフレームの位置を保存
        const prevX = this.x;
        const prevY = this.y;

        // 重力適用
        this.vy += 0.5;
        
        // 位置更新
        this.x += this.vx;
        this.y += this.vy;

        // 摩擦
        this.vx *= 0.85;

        // 地面との衝突
        const groundLevel = 500;
        if (this.y + this.height > groundLevel) {
            this.y = groundLevel - this.height;
            this.vy = 0;
            this.onGround = true;
        }

        // プラットフォームとの衝突チェック
        this.onGround = this.y + this.height >= groundLevel - 1; // 地面にいるかチェック
        
        for (const platform of gameState.platforms) {
            const collision = checkCollisionWithPrevious(
                {x: this.x, y: this.y, width: this.width, height: this.height, vx: this.vx, vy: this.vy},
                {x: prevX, y: prevY, width: this.width, height: this.height},
                platform
            );
            
            if (collision.colliding) {
                if (collision.fromTop && this.vy > 0) {
                    // 上から着地
                    this.y = platform.y - this.height;
                    this.vy = 0;
                    this.onGround = true;
                } else if (collision.fromBottom && this.vy < 0) {
                    // 下から衝突
                    this.y = platform.y + platform.height;
                    this.vy = 0;
                } else if (collision.fromLeft && this.vx > 0) {
                    // 左から衝突
                    this.x = platform.x - this.width;
                    this.vx = 0;
                } else if (collision.fromRight && this.vx < 0) {
                    // 右から衝突
                    this.x = platform.x + platform.width;
                    this.vx = 0;
                }
            }
        }

        // 障害物との衝突チェック（無敵時間チェック追加）
        if (!this.invulnerable || Date.now() > this.invulnerable) {
            for (const obstacle of gameState.obstacles) {
                if (this.x < obstacle.x + obstacle.width &&
                    this.x + this.width > obstacle.x &&
                    this.y < obstacle.y + obstacle.height &&
                    this.y + this.height > obstacle.y) {
                    
                    // 障害物の種類によって処理を分ける
                    switch(obstacle.type) {
                        case 'spike':
                            this.health -= 2;
                            // ノックバック効果
                            this.vx = -5;
                            this.vy = -8;
                            break;
                        case 'moving':
                            this.health -= 1;
                            // 動く障害物の移動方向と逆にノックバック
                            this.vx = obstacle.moveSpeed > 0 ? -8 : 8;
                            this.vy = -5;
                            break;
                        case 'hole':
                            this.health -= 5;
                            this.vy = 2; // 穴に落とす
                            break;
                        case 'wall':
                            // 壁の場合は位置を修正
                            if (this.vx > 0) {
                                this.x = obstacle.x - this.width;
                            } else {
                                this.x = obstacle.x + obstacle.width;
                            }
                            this.vx = 0;
                            break;
                    }
                    
                    // 体力が0以下になったらリスポーン
                    if (this.health <= 0) {
                        this.respawn();
                    }
                    
                    // 連続ダメージを防ぐため、短時間無敵状態にする
                    this.invulnerable = Date.now() + 1000; // 1秒間無敵
                    break; // 1つの障害物との衝突のみ処理
                }
            }
        }

        // コインとの衝突チェック
        for (const coin of gameState.coins) {
            if (!coin.collected &&
                this.x < coin.x + coin.width &&
                this.x + this.width > coin.x &&
                this.y < coin.y + coin.height &&
                this.y + this.height > coin.y) {
                
                coin.collected = true;
                this.score += 10;
            }
        }

        // 新しいチャンクが必要か確認
        const currentChunk = Math.floor(this.x / gameState.chunkSize);
        const maxChunk = Math.floor(Math.max(...Object.values(gameState.players).map(p => p.x)) / gameState.chunkSize);
        
        if (maxChunk > gameState.platforms.length / 10) {
            const newChunk = generateChunk((maxChunk + 1) * gameState.chunkSize);
            gameState.platforms.push(...newChunk.platforms);
            gameState.obstacles.push(...newChunk.obstacles);
            gameState.coins.push(...newChunk.coins);
        }
    }

    respawn() {
        this.x = 100;
        this.y = 400;
        this.vx = 0;
        this.vy = 0;
        this.health = 100;
        this.invulnerable = Date.now() + 2000; // リスポーン後2秒間無敵
    }

    jump() {
        if (this.onGround) {
            this.vy = -15;
            this.onGround = false;
        }
    }

    moveLeft() {
        this.vx -= 1;
        if (this.vx < -8) this.vx = -8;
    }

    moveRight() {
        this.vx += 1;
        if (this.vx > 8) this.vx = 8;
    }
}

// 動く障害物の更新
function updateMovingObstacles() {
    for (const obstacle of gameState.obstacles) {
        if (obstacle.type === 'moving') {
            obstacle.x += obstacle.moveSpeed;
            
            // 範囲外に出たら方向転換
            const chunkStart = Math.floor(obstacle.x / gameState.chunkSize) * gameState.chunkSize;
            if (obstacle.x <= chunkStart || obstacle.x >= chunkStart + gameState.chunkSize - obstacle.width) {
                obstacle.moveSpeed *= -1;
            }
        }
    }
}

// WebSocket接続処理
io.on('connection', (socket) => {
    console.log('プレイヤーが接続しました:', socket.id);

    socket.on('join', (playerName) => {
        const player = new Player(socket.id, playerName || 'Anonymous');
        gameState.players[socket.id] = player;
        
        socket.emit('gameState', {
            players: gameState.players,
            platforms: gameState.platforms,
            obstacles: gameState.obstacles,
            coins: gameState.coins
        });

        socket.broadcast.emit('playerJoined', player);
    });

    socket.on('move', (direction) => {
        const player = gameState.players[socket.id];
        if (player) {
            switch (direction) {
                case 'left':
                    player.moveLeft();
                    break;
                case 'right':
                    player.moveRight();
                    break;
                case 'jump':
                    player.jump();
                    break;
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('プレイヤーが切断しました:', socket.id);
        delete gameState.players[socket.id];
        socket.broadcast.emit('playerLeft', socket.id);
    });
});

// ゲームループ
setInterval(() => {
    // プレイヤー更新
    for (const player of Object.values(gameState.players)) {
        player.update();
    }

    // 動く障害物更新
    updateMovingObstacles();

    // 全プレイヤーに状態送信
    io.emit('update', {
        players: gameState.players,
        obstacles: gameState.obstacles,
        coins: gameState.coins
    });
}, 1000 / 60); // 60 FPS

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`サーバーがポート ${PORT} で起動しました`);
    console.log(`http://localhost:${PORT} でアクセスできます`);
});
