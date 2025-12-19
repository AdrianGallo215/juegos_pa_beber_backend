const { getRandomLetter, getRandomCategories, generateRoomCode } = require('./utils');

class GameManager {
    constructor(io) {
        this.io = io;
        this.rooms = new Map();
        // Reverse lookup: socketId -> { roomCode, playerId }
        this.socketMap = new Map();
    }

    createRoom(playerId, playerName, socketId) {
        const code = generateRoomCode();

        const room = {
            code,
            hostId: playerId,
            players: [{ id: playerId, name: playerName, score: 0, connected: true, socketId }],
            state: 'LOBBY',
            round: 0,
            maxRounds: 5,
            categories: getRandomCategories(),
            usedLetters: [],
            currentLetter: '',
            answers: {},
            roundVotes: {},
            roundEndTime: 0,
            stopCalledBy: null,
            votingIdx: 0
        };

        this.rooms.set(code, room);
        this.socketMap.set(socketId, { roomCode: code, playerId });

        return code;
    }

    joinRoom(code, playerId, playerName, socketId) {
        const room = this.rooms.get(code);
        if (!room) return { error: 'Room not found' };

        // Check if player is already in (rejoin)
        const existingPlayer = room.players.find(p => p.id === playerId);

        if (existingPlayer) {
            // Update connection status
            existingPlayer.connected = true;
            existingPlayer.socketId = socketId;
            existingPlayer.name = playerName; // Update name if changed?
            this.socketMap.set(socketId, { roomCode: code, playerId });
            return { room, isRejoin: true };
        }

        if (room.state !== 'LOBBY') return { error: 'Game already started' };

        room.players.push({ id: playerId, name: playerName, score: 0, connected: true, socketId });
        this.socketMap.set(socketId, { roomCode: code, playerId });

        return { room, isRejoin: false };
    }

    handleDisconnect(socketId) {
        const info = this.socketMap.get(socketId);
        if (!info) return;

        const room = this.rooms.get(info.roomCode);
        if (room) {
            const player = room.players.find(p => p.id === info.playerId);
            if (player) {
                player.connected = false;
                // Notify others?
                // For now we keep them in the game so they can reconnect.
            }
        }
        this.socketMap.delete(socketId);
    }

    // ... (rest of the methods updated to use playerId lookups if needed)
    startRound(code) {
        const room = this.rooms.get(code);
        if (!room) return;

        room.state = 'PLAYING';
        room.round++;
        room.currentLetter = getRandomLetter(room.usedLetters);
        room.usedLetters.push(room.currentLetter);
        room.answers = {};
        room.stopCalledBy = null;
        room.roundEndTime = Date.now() + 180 * 1000;

        this.io.to(code).emit('round_started', {
            round: room.round,
            letter: room.currentLetter,
            endTime: room.roundEndTime,
            categories: room.categories
        });
    }

    stopRound(code, playerId) {
        const room = this.rooms.get(code);
        if (!room || room.state !== 'PLAYING') return;

        room.stopCalledBy = playerId;
        room.state = 'VOTING_TRANSITION';

        this.io.to(code).emit('round_stopped', { stoppedBy: playerId });
        room.state = 'COLLECTING_ANSWERS';
    }
}

module.exports = GameManager;
