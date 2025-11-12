class P2PGameNetwork {
  constructor(options = {}) {

    this.config = {

      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }, 
        { urls: 'stun:stun1.l.google.com:19302' }
      ],

      signalingServer: options.signalingServer || 'ws://dono-01.danbot.host:9550/',

      dataChannelConfig: {
        ordered: false,        
        maxRetransmits: 0,     
      },
      ...options
    };

    this.peers = new Map();           
    this.dataChannels = new Map();    
    this.localPlayerId = this.generatePlayerId();
    this.isHost = false;
    this.gameState = 'disconnected';  

    this.onPeerConnected = null;
    this.onPeerDisconnected = null;
    this.onGameDataReceived = null;
    this.onGameStateChanged = null;
    this.onError = null;

    this.signalingSocket = null;

    this.stats = {
      bytesSent: 0,
      bytesReceived: 0,
      messagesSent: 0,
      messagesReceived: 0,
      connectionAttempts: 0
    };

    this.setupEventHandlers();
  }

  generatePlayerId() {
    return 'player_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  setupEventHandlers() {

    window.addEventListener('beforeunload', () => {
      this.disconnect();
    });

    window.addEventListener('online', () => {
      if (this.gameState === 'disconnected') {
        this.log('Network back online, attempting to reconnect...');

      }
    });

    window.addEventListener('offline', () => {
      this.log('Network went offline');
      this.handleNetworkError('Network connection lost');
    });
  }

  async connectToSignalingServer() {
    return new Promise((resolve, reject) => {
      try {
        this.log('Connecting to signaling server...');
        this.signalingSocket = new WebSocket(this.config.signalingServer);

        this.signalingSocket.onopen = () => {
          this.log('Connected to signaling server');
          this.gameState = 'connected';
          this.notifyGameStateChanged();
          resolve();
        };

        this.signalingSocket.onmessage = (event) => {
          this.handleSignalingMessage(JSON.parse(event.data));
        };

        this.signalingSocket.onclose = () => {
          this.log('Signaling server connection closed');
          this.gameState = 'disconnected';
          this.notifyGameStateChanged();
        };

        this.signalingSocket.onerror = (error) => {
          this.log('Signaling server error:', error);
          reject(error);
        };

        setTimeout(() => {
          if (this.signalingSocket.readyState !== WebSocket.OPEN) {
            reject(new Error('Signaling server connection timeout'));
          }
        }, 10000);

      } catch (error) {
        reject(error);
      }
    });
  }

  async createGameRoom(roomId) {
    try {
      await this.connectToSignalingServer();

      this.isHost = true;
      this.roomId = roomId;

      this.sendSignalingMessage({
        type: 'create-room',
        roomId: roomId,
        playerId: this.localPlayerId
      });

      this.log(`Created game room: ${roomId}`);
      return roomId;
    } catch (error) {
      this.handleError('Failed to create game room', error);
      throw error;
    }
  }

async joinGameRoom(roomId) {
  await this.connectToSignalingServer();
  this.isHost = false;
  this.roomId = roomId;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for join confirmation'));
    }, 5000);

    const onMessage = (event) => {
      const message = JSON.parse(event.data);

      if (message.type === 'room-joined' && message.roomId === roomId) {
        clearTimeout(timeout);
        this.signalingSocket.removeEventListener('message', onMessage);
        resolve();
      } else if (message.type === 'error' && message.error.includes('Room does not exist')) {
        clearTimeout(timeout);
        this.signalingSocket.removeEventListener('message', onMessage);
        reject(new Error(message.error));
      }
    };

    this.signalingSocket.addEventListener('message', onMessage);

    this.sendSignalingMessage({
      type: 'join-room',
      roomId: roomId,
      playerId: this.localPlayerId
    });

    this.log(`Attempting to join room: ${roomId}`);
  });
}

  async handleSignalingMessage(message) {
    this.log('Received signaling message:', message.type);

    switch (message.type) {
      case 'room-created':
        this.log('Room created successfully');
        break;

      case 'room-joined':
        this.log('Joined room successfully');
        break;

      case 'peer-joined':

        this.log(`Peer joined: ${message.playerId}`);
        if (this.isHost) {

          await this.createPeerConnection(message.playerId, true);
        }
        break;

      case 'webrtc-offer':

        await this.handleWebRTCOffer(message);
        break;

      case 'webrtc-answer':

        await this.handleWebRTCAnswer(message);
        break;

      case 'webrtc-ice-candidate':

        await this.handleICECandidate(message);
        break;

      case 'peer-left':

        this.log(`Peer left: ${message.playerId}`);
        this.removePeer(message.playerId);
        break;

      case 'error':
        this.handleError('Signaling server error', message.error);
        break;

      default:
        this.log('Unknown signaling message type:', message.type);
    }
  }

  async createPeerConnection(peerId, isInitiator = false) {
    try {
      this.log(`Creating peer connection with ${peerId}`);
      this.stats.connectionAttempts++;

      const peerConnection = new RTCPeerConnection({
        iceServers: this.config.iceServers
      });

      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          this.sendSignalingMessage({
            type: 'webrtc-ice-candidate',
            targetPeer: peerId,
            candidate: event.candidate
          });
        }
      };

      peerConnection.onconnectionstatechange = () => {
        this.log(`Connection state with ${peerId}: ${peerConnection.connectionState}`);

        if (peerConnection.connectionState === 'connected') {
          this.log(`Successfully connected to peer ${peerId}`);
          if (this.onPeerConnected) {
            this.onPeerConnected(peerId);
          }
        } else if (peerConnection.connectionState === 'disconnected' || 
                   peerConnection.connectionState === 'failed') {
          this.log(`Lost connection to peer ${peerId}`);
          this.removePeer(peerId);
        }
      };

      this.peers.set(peerId, peerConnection);

      if (isInitiator) {

        const dataChannel = peerConnection.createDataChannel('gameData', this.config.dataChannelConfig);
        this.setupDataChannel(dataChannel, peerId);

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        this.sendSignalingMessage({
          type: 'webrtc-offer',
          targetPeer: peerId,
          offer: offer
        });
      } else {

        peerConnection.ondatachannel = (event) => {
          this.setupDataChannel(event.channel, peerId);
        };
      }

    } catch (error) {
      this.handleError(`Failed to create peer connection with ${peerId}`, error);
    }
  }

  async handleWebRTCOffer(message) {
    try {
      const peerId = message.fromPeer;
      let peerConnection = this.peers.get(peerId);

      if (!peerConnection) {
        await this.createPeerConnection(peerId, false);
        peerConnection = this.peers.get(peerId);
      }

      await peerConnection.setRemoteDescription(message.offer);
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      this.sendSignalingMessage({
        type: 'webrtc-answer',
        targetPeer: peerId,
        answer: answer
      });

    } catch (error) {
      this.handleError('Failed to handle WebRTC offer', error);
    }
  }

  async handleWebRTCAnswer(message) {
    try {
      const peerId = message.fromPeer;
      const peerConnection = this.peers.get(peerId);

      if (peerConnection) {
        await peerConnection.setRemoteDescription(message.answer);
      }

    } catch (error) {
      this.handleError('Failed to handle WebRTC answer', error);
    }
  }

  async handleICECandidate(message) {
    try {
      const peerId = message.fromPeer;
      const peerConnection = this.peers.get(peerId);

      if (peerConnection) {
        await peerConnection.addIceCandidate(message.candidate);
      }

    } catch (error) {
      this.handleError('Failed to handle ICE candidate', error);
    }
  }

  setupDataChannel(dataChannel, peerId) {
    this.log(`Setting up data channel with ${peerId}`);

    dataChannel.onopen = () => {
      this.log(`Data channel opened with ${peerId}`);
      this.dataChannels.set(peerId, dataChannel);
    };

    dataChannel.onclose = () => {
      this.log(`Data channel closed with ${peerId}`);
      this.dataChannels.delete(peerId);
    };

    dataChannel.onmessage = (event) => {
      try {
        const gameData = JSON.parse(event.data);
        this.stats.messagesReceived++;
        this.stats.bytesReceived += event.data.length;

        if (this.onGameDataReceived) {
          this.onGameDataReceived(peerId, gameData);
        }
      } catch (error) {
        this.log('Failed to parse game data:', error);
      }
    };

    dataChannel.onerror = (error) => {
      this.log(`Data channel error with ${peerId}:`, error);
    };
  }

  sendGameData(peerId, data) {
    const dataChannel = this.dataChannels.get(peerId);
    if (dataChannel && dataChannel.readyState === 'open') {
      try {
        const message = JSON.stringify(data);
        dataChannel.send(message);
        this.stats.messagesSent++;
        this.stats.bytesSent += message.length;
      } catch (error) {
        this.log(`Failed to send game data to ${peerId}:`, error);
      }
    }
  }

  broadcastGameData(data) {
    for (const [peerId, dataChannel] of this.dataChannels) {
      if (dataChannel.readyState === 'open') {
        this.sendGameData(peerId, data);
      }
    }
  }

  sendSignalingMessage(message) {
    if (this.signalingSocket && this.signalingSocket.readyState === WebSocket.OPEN) {
      message.fromPeer = this.localPlayerId;
      message.roomId = this.roomId;
      this.signalingSocket.send(JSON.stringify(message));
    }
  }

  removePeer(peerId) {

    const dataChannel = this.dataChannels.get(peerId);
    if (dataChannel) {
      dataChannel.close();
      this.dataChannels.delete(peerId);
    }

    const peerConnection = this.peers.get(peerId);
    if (peerConnection) {
      peerConnection.close();
      this.peers.delete(peerId);
    }

    if (this.onPeerDisconnected) {
      this.onPeerDisconnected(peerId);
    }
  }

  getConnectedPeers() {
    return Array.from(this.dataChannels.keys()).filter(peerId => {
      const channel = this.dataChannels.get(peerId);
      return channel && channel.readyState === 'open';
    });
  }

  getNetworkStats() {
    return {
      ...this.stats,
      connectedPeers: this.getConnectedPeers().length,
      gameState: this.gameState,
      isHost: this.isHost,
      playerId: this.localPlayerId,
      roomId: this.roomId
    };
  }

  disconnect() {
    this.log('Disconnecting from all peers...');

    for (const [peerId, peerConnection] of this.peers) {
      peerConnection.close();
    }
    this.peers.clear();
    this.dataChannels.clear();

    if (this.signalingSocket) {
      this.signalingSocket.close();
      this.signalingSocket = null;
    }

    this.gameState = 'disconnected';
    this.notifyGameStateChanged();
  }

  handleNetworkError(message) {
    this.log('Network error:', message);
    if (this.onError) {
      this.onError(message);
    }
  }

  handleError(message, error = null) {
    this.log('Error:', message, error);
    if (this.onError) {
      this.onError(message, error);
    }
  }

  notifyGameStateChanged() {
    if (this.onGameStateChanged) {
      this.onGameStateChanged(this.gameState);
    }
  }

  log(...args) {
    console.log('[P2P]', ...args);
  }
}

window.P2PGameNetwork = P2PGameNetwork;