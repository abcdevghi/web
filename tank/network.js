// network.js - WebSocket connection and all server message handling

import { WS_URL } from './config.js';

export class NetworkManager {
    constructor() {
        this.socket = null;
        this.socketReady = false;
        this.messageQueue = [];
        this.messageHandlers = {};
    }

    initialize() {
        console.log('Initializing network connection...');
        this.socketReady = false;
        this.messageQueue = [];

        if (this.socket) {
            try {
                this.socket.onopen = null;
                this.socket.onclose = null;
                this.socket.onerror = null;
                this.socket.onmessage = null;
                this.socket.close();
            } catch (e) {
                console.log('Error closing existing socket:', e);
            }
        }

        this.socket = new WebSocket(WS_URL);

        this.socket.onopen = () => {
            console.log('WebSocket connection opened');
            this.socketReady = true;

            while (this.messageQueue.length > 0) {
                const msg = this.messageQueue.shift();
                this.send(msg);
            }
        };

        this.socket.onclose = (event) => {
            console.log('WebSocket connection closed:', event.code, event.reason);
            this.socketReady = false;

            if (event.code !== 1000) {
                setTimeout(() => {
                    console.log('Attempting to reconnect...');
                    if (!this.socket || this.socket.readyState === WebSocket.CLOSED) {
                        this.initialize();
                    }
                }, 3000);
            }
        };

        this.socket.onerror = (err) => {
            console.error('WebSocket error:', err);
            this.socketReady = false;
        };

        this.socket.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                this.handleMessage(msg);
            } catch (e) {
                console.error('Error parsing message:', e, event.data);
            }
        };
    }

    send(data) {
        if (!this.socket) {
            console.warn('No socket connection exists');
            return;
        }

        if (this.socketReady && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(data));
        } else {
            this.messageQueue.push(data);
        }
    }

    on(messageType, handler) {
        this.messageHandlers[messageType] = handler;
    }

    handleMessage(data) {
        console.log('Handling server message:', data.type, data);

        const handler = this.messageHandlers[data.type];
        if (handler) {
            handler(data);
        } else {
            console.warn('No handler for message type:', data.type);
        }
    }

    isConnected() {
        return this.socketReady && this.socket && this.socket.readyState === WebSocket.OPEN;
    }
}

// Message handler factory - these get registered in game.js
export function createMessageHandlers(game) {
    return {
        'room-joined': (data) => {
            game.myPlayerId = data.playerId;
            game.myUsername = `${data.username}#${game.myPlayerId.split('_')[1]}`;
            game.playerUsernames.set(game.myPlayerId, game.myUsername);
            game.addChatMessage(`Joined game as: ${game.myUsername}`);
            game.showGameUI();

            if (data.gameInProgress) {
                game.network.send({ type: 'request-late-join-sync' });
            }
        },

        'player-joined': (data) => {
            console.log('New player joined:', data.playerId, data.username);
            game.playerUsernames.set(data.playerId, data.username);
            game.updatePlayerCount();

            if (game.gameState === 'playing') {
                game.addLateJoinerTank(data.playerId);
            }
        },

        'player-disconnected': (data) => {
            game.handlePlayerDisconnect(data.playerId);
        },

        'player-list': (data) => {
            console.log('Updating player list:', data.players);

            const oldPlayers = new Set(game.playerUsernames.keys());
            game.playerUsernames.clear();

            for (const [playerId, username] of Object.entries(data.players)) {
                game.playerUsernames.set(playerId, username);
            }

            for (const oldPlayerId of oldPlayers) {
                if (!game.playerUsernames.has(oldPlayerId)) {
                    game.handlePlayerDisconnect(oldPlayerId);
                }
            }

            game.updatePlayerCount();

            if (game.gameState !== 'playing') {
                game.tankManager.resetTanks();
            } else {
                game.addMissingTanks();
            }
        },

        'tank-move': (data) => {
            game.tankManager.handleTankMove(data);
        },

        'turn-change': (data) => {
            game.handleTurnChange(data);
        },

        'bullet-fired': (data) => {
            console.log('Bullet fired by:', data.playerId);
            game.bulletManager.createBulletFromServer(data);
        },

        'direct-hit': (data) => {
            console.log('Direct hit received:', data);
            game.tankManager.handleDirectHit(data);
        },

        'explosion': (data) => {
            console.log('Explosion received:', data);
            game.terrainManager.handleExplosion(data);
        },

        'terrain-sync': (data) => {
            if (data.terrain) {
                game.terrainManager.loadTerrain(data.terrain);
            }
        },

        'chat': (data) => {
            game.addChatMessage(`${data.username}: ${data.message}`);
        },

        'game-state-sync': (data) => {
            game.gameState = data.gameState;
            if (data.endMessage) {
                game.addChatMessage(data.endMessage);
            }
            if (data.gameState === 'ended') {
                game.tankFavicon.updateFavicon(null, 'ended');
            }
        },

        'game-state': (data) => {
            console.log('Game state update:', data.gameState);
            if (data.gameState === 'playing') {
                game.newSeed = data.seed;
                game.terrainManager.generate(data.seed);
                game.gameState = 'playing';
                game.gameStarted = true;

                game.currentTurn = 0;
                game.volleyCount = 0;

                game.tankManager.resetTanks(true);
                game.addChatMessage('🚀 Game started!');

                setTimeout(() => {
                    const allPlayers = Array.from(game.playerUsernames.keys());
                    if (allPlayers.length > 0) {
                        const firstPlayer = data.currentPlayerId || allPlayers[0];
                        game.isMyTurn = firstPlayer === game.myPlayerId;
                        game.canFire = game.isMyTurn && game.bullets.length === 0;

                        console.log('Initial turn state set:', {
                            firstPlayer,
                            myPlayerId: game.myPlayerId,
                            isMyTurn: game.isMyTurn,
                            canFire: game.canFire
                        });

                        game.updateTurnIndicator();
                        game.tankFavicon.updateFavicon(firstPlayer, 'playing');
                    }
                }, 100);
            }
        },

        'late-join-sync': (data) => {
            game.handleLateJoinSync(data);
        },

        'server-shutdown': (data) => {
            game.addChatMessage('🔴 Server is shutting down...');
            game.resetGameState();
        }
    };
}
