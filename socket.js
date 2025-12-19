const GameManager = require('./gameManager');

module.exports = (io) => {
    const gameManager = new GameManager(io);

    io.on('connection', (socket) => {
        console.log('User connected:', socket.id);

        // Provide a way to rejoin
        socket.on('rejoin_request', ({ playerId, roomCode, playerName }) => {
            if (!roomCode || !playerId) return;

            const result = gameManager.joinRoom(roomCode, playerId, playerName, socket.id);

            if (result && result.room) {
                socket.join(roomCode);

                // Send full current state
                socket.emit('state_restored', {
                    roomCode,
                    playerId,
                    isHost: result.room.hostId === playerId,
                    players: result.room.players,
                    state: result.room.state,
                    roundData: {
                        round: result.room.round,
                        letter: result.room.currentLetter,
                        endTime: result.room.roundEndTime,
                        categories: result.room.categories
                    },
                    // Add stored answers if any, so client can populate input
                    myAnswers: result.room.answers[playerId] || {}
                });

                // If we are in voting, we also need to send voting state
                if (result.room.state === 'VOTING') {
                    const target = result.room.players[result.room.votingIdx];
                    socket.emit('start_voting_phase', {
                        targetPlayer: { id: target.id, name: target.name },
                        answers: result.room.answers[target.id] || {}
                    });
                }

                // If we are in RESULTS
                if (result.room.state === 'ROUND_RESULTS') {
                    const leaderboard = [...result.room.players].sort((a, b) => b.score - a.score);
                    socket.emit('round_ended', { leaderboard, isGameOver: result.room.round >= result.room.maxRounds });
                }

                // Notify others that player is back (connected status)
                io.to(roomCode).emit('update_players', result.room.players);
            } else {
                socket.emit('error', { message: 'Could not rejoin room', code: 'REJOIN_FAILED' });
            }
        });

        socket.on('create_room', ({ playerName, playerId }) => {
            // Use client-generated UUID as playerId
            const code = gameManager.createRoom(playerId, playerName, socket.id);
            socket.join(code);
            socket.emit('room_created', { code, playerId });

            const room = gameManager.rooms.get(code);
            io.to(code).emit('update_players', room.players);
        });

        socket.on('join_room', ({ code, playerName, playerId }) => {
            const result = gameManager.joinRoom(code, playerId, playerName, socket.id);
            if (result && !result.error) {
                socket.join(code);
                socket.emit('room_joined', { code, playerId });
                io.to(code).emit('update_players', result.room.players);
            } else {
                socket.emit('error', { message: result ? result.error : 'Room not found' });
            }
        });

        socket.on('start_game', ({ code }) => {
            gameManager.startRound(code);
        });

        socket.on('stop_round', ({ code }) => {
            // We need to know WHO called it. socket.id is tricky if we use mapping.
            // We can look up playerId from socket.id
            const info = gameManager.socketMap.get(socket.id);
            if (info) {
                gameManager.stopRound(code, info.playerId);
                io.to(code).emit('request_answers');
            }
        });

        socket.on('submit_answers', ({ code, answers }) => {
            const info = gameManager.socketMap.get(socket.id);
            if (!info) return;

            const room = gameManager.rooms.get(code);
            if (!room) return;

            room.answers[info.playerId] = answers;

            // Count submitted
            const submittedCount = Object.keys(room.answers).length;
            const activePlayers = room.players.filter(p => p.connected).length;

            // Use active players or total? Start with total for safety, or active?
            // Let's use room.players.length but be careful of zombies.
            // If everyone connected has submitted...

            if (submittedCount >= room.players.length) {
                room.state = 'VOTING';
                room.votingIdx = 0;
                startVotingForPlayer(io, room);
            }
        });

        socket.on('reset_game', ({ code }) => {
            gameManager.resetGame(code);
        });

        socket.on('submit_votes', ({ code, targetPlayerId, votes }) => {
            const info = gameManager.socketMap.get(socket.id);
            if (!info) return;

            const room = gameManager.rooms.get(code);
            if (!room || room.state !== 'VOTING') return;

            if (!room.roundVotes) room.roundVotes = {};
            room.roundVotes[info.playerId] = votes;

            // Emit progress update
            const voters = Object.keys(room.roundVotes);
            // Voters needed = all connected players EXCEPT target
            const activePlayers = room.players.filter(p => p.connected);
            const neededVoters = activePlayers.filter(p => p.id !== targetPlayerId).length;

            io.to(code).emit('voting_progress', {
                voters,
                totalNeeded: neededVoters
            });

            // Check completion
            // We need votes from ALL other players
            if (voters.length >= neededVoters) {
                // Tally
                const targetPlayer = room.players[room.votingIdx];
                let roundScore = 0;
                const targetAnswers = room.answers[targetPlayerId] || {};

                // Store validation results for history
                if (!targetPlayer.roundResults) targetPlayer.roundResults = {};
                const detailedResults = {}; // For interim display

                room.categories.forEach(cat => {
                    const word = targetAnswers[cat];
                    // Auto-fail empty
                    if (!word) {
                        targetPlayer.roundResults[cat] = false;
                        detailedResults[cat] = { word: '', valid: false, votesFor: 0, votesAgainst: neededVoters };
                        return;
                    }

                    let validVotes = 0;
                    let totalVotes = 0;

                    Object.entries(room.roundVotes).forEach(([voterId, voterVotes]) => {
                        if (voterId === targetPlayerId) return; // Should already be filtered but safety
                        if (voterVotes[cat] === true) validVotes++;
                        totalVotes++;
                    });

                    // Logic: > 50% of VOTERS (not total players, just those who voted? We enforced all must vote)
                    let isValid = false;
                    if (totalVotes === 0) isValid = true; // No other players?
                    else if (validVotes > totalVotes / 2) isValid = true;

                    if (isValid) {
                        roundScore += 10;
                    }
                    targetPlayer.roundResults[cat] = isValid;
                    detailedResults[cat] = { word, valid: isValid, votesFor: validVotes, votesAgainst: totalVotes - validVotes };
                });

                targetPlayer.score += roundScore;

                // Emit INTERIM results
                io.to(code).emit('player_round_total', {
                    player: { id: targetPlayer.id, name: targetPlayer.name },
                    roundScore,
                    totalScore: targetPlayer.score,
                    details: detailedResults
                });

                room.votingIdx++;
                room.roundVotes = {};

                // Wait 5 seconds before next player
                setTimeout(() => {
                    if (room.votingIdx >= room.players.length) {
                        endRound(io, room);
                    } else {
                        startVotingForPlayer(io, room);
                    }
                }, 5000);
            }
        });

        socket.on('disconnect', () => {
            gameManager.handleDisconnect(socket.id);
        });

    });
};

function startVotingForPlayer(io, room) {
    const targetPlayer = room.players[room.votingIdx];
    const answers = room.answers[targetPlayer.id] || {};

    io.to(room.code).emit('start_voting_phase', {
        targetPlayer: { id: targetPlayer.id, name: targetPlayer.name },
        answers: answers
    });
}

function endRound(io, room) {
    room.state = 'ROUND_RESULTS';
    const leaderboard = [...room.players].sort((a, b) => b.score - a.score);

    // Compile details for this round
    const roundDetails = room.players.map(p => ({
        id: p.id,
        name: p.name,
        answers: room.answers[p.id] || {},
        validations: p.roundResults || {},
        totalScore: p.score
    }));

    // Save to history if needed
    room.history.push({
        round: room.round,
        letter: room.currentLetter,
        details: roundDetails
    });

    io.to(room.code).emit('round_ended', {
        leaderboard,
        isGameOver: room.round >= room.maxRounds,
        roundDetails, // Send current round details
        categories: room.categories
    });

    // Clear temporary round data safely
    room.players.forEach(p => delete p.roundResults);
}
