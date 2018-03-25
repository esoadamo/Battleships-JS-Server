const app = require('express')();
const http = require('http').Server(app);
const io = require('socket.io')(http, {origins: '*:*'});
const moment = require('moment');
const uuid = require('uuid/v4');

const PORT = 8473; // server port

// TO-DO updated logging icons

const Client = function(socket) {
  this.name = null; // unique name of the client
  this.socket = socket; // socket he has connected from
  this.nationality = null; // One of the Client.nationalities's items
  this.room = null; // null, lobby
  this.opponent = null; // who wants to test strength again this little fellow?
  this.hasTurn = false;
  this.board = null;
  this.gameCompleted = false;
  this.challengedBy = [];

  /**
   *  Emits clientĹist with list of all current clients in lobby
   */
  this.sendClientsList = () => {
    let emittedData = []
    for (let client of clients)
      if ((client !== this) && (client.room === 'lobby'))
        emittedData.push({
          'name': client.name,
          'nationality': client.nationality
        });
    this.socket.emit('clientList', emittedData);
  };

  /**
   * Changes room, sending requiered events
   */
  this.switchRoom = (room) => {
      if (this.room !== null)
        this.socket.leave(room);

      // Entering the lobby
      if (room === 'lobby') {
        io.sockets.in(room).emit('clientJoinedLobby', {
          'name': this.name,
          'nationality': this.nationality
        });

        // Clients wants to challenge somebody
        this.socket.on('gameChallenge', (opponentName) => {
          let opponent = Client.clientByName(opponentName, room);
          if (opponent === null) {
            this.socket.emit('gameChallengeDecline', data);
            return;
          }
          // Asked opponent is in lobby, send him a challenge message with our name
          opponent.socket.emit('gameChallenge', this.name);
        });

        // This stranger is not worth of my time, do not battle him
        this.socket.on('gameChallengeDecline', (notWorthyMyAttentionName) => {
          let opponent = Client.clientByName(notWorthyMyAttentionName, room);
          if (opponent === null)
            return;
          opponent.socket.emit('gameChallengeDecline', this.name);
        });

        // This seems like an interesting challenge!
        this.socket.on('gameChallengeAccept', (opponentName) => {
          /*
          Create separate room for battle with "battle-" prefix and emit gameStarting in the room
          Data for gameStarting event are list of the clients names and nationalities
          */
          let opponent = Client.clientByName(opponentName, room);
          if (opponent === null)
            return;
          let battleRoomName = "";
          do {
            battleRoomName = "battle-" + uuid();
          } while (battleRoomName in Object.keys(battles));
          battles[battleRoomName] = [this, opponent];
          this.opponent = opponent;
          opponent.opponent = this;
          this.switchRoom(battleRoomName);
          opponent.switchRoom(battleRoomName);
          console.log(`[${moment().format('HH:mm:ss')}] →  ${this.name} and ${this.opponent.name} have entered draft phase`);
          io.sockets.in(battleRoomName).emit('gameStarting', [{
            'name': this.name,
            'nationality': this.nationality,
            'you': true
          }, {
            'name': opponent.name,
            'nationality': opponent.nationality,
            'you': false
          }]);
        });
      }

      // Leaving the lobby
      if (this.room === 'lobby') {
        this.socket.removeAllListeners('gameChallenge');
        io.sockets.in(this.room).emit('clientLeftLobby', {
          'name': this.name,
          'nationality': this.nationality
        });
        this.declineAllChallenges();
      }


      // Entering battle
      if ((room !== null) && (room.startsWith('battle-'))) {
        this.gameCompleted = false;
        this.hasTurn = false;
        this.socket.on('draftCompleted', (board) => {
          console.log(`[${moment().format('HH:mm:ss')}] →  ${this.name} has completed their draft`);
          this.board = board;

          // You drafter first, you get your turn
          if (this.opponent.board === null)
            this.hasTurn = true;
          else { // ok, you were late, but still. It's time to start this party
            console.log(`[${moment().format('HH:mm:ss')}] →  starting game between ${this.opponent.name} and ${this.name}`);
            this.socket.emit('opponentReady', {
              'you': false,
              'opponent': this.opponent.name
            });
            this.opponent.socket.emit('opponentReady', {
              'you': true,
              'opponent': this.name
            });
          }
        });

        this.socket.on('shotFired', field => {
          stats[this.name].shotsFired++;
          stats[this.opponent.name].shotsTaken++;

          let includes = null;

          this.opponent.board.forEach(ship => {
            if (ship.fieldsLeft.includes(field)) {
              ship.fieldsLeft = ship.fieldsLeft.filter(n => n !== field);
              includes = ship;
            }
          })

          if (includes === null) {
            console.log(`[${moment().format('HH:mm:ss')}] →  ${this.name} just fired at ${this.opponent.name}'s field ${field} (and missed)`);

            this.socket.emit('shotMissed', { field, wasItYourShot: true });
            this.opponent.socket.emit('shotMissed', { field, wasItYourShot: false });
          } else {
            if (!includes.fieldsLeft.length) {

              stats[this.name].shotsFiredHit++;
              stats[this.opponent.name].shotsTakenHit++;

              console.log(`[${moment().format('HH:mm:ss')}] →  ${this.name} just fired at ${this.opponent.name}'s field ${field} (and sunk his ship)`);

              const ship = includes;
              this.socket.emit('shipSunk', { ship, wasItYourShot: true });
              this.opponent.socket.emit('shipSunk', { ship, wasItYourShot: false });

              const shipsLeft = this.opponent.board
                .map(s => s.fieldsLeft.length > 0)
                .filter(b => b)
                .length;

              if (!shipsLeft) {
                console.log(`[${moment().format('HH:mm:ss')}] →  ${this.name} has won the battle`);

                this.socket.emit('gameFinished', { youAreTheWinner: true });
                this.opponent.socket.emit('gameFinished', { youAreTheWinner: false });

                stats[this.name].wins++;
                stats[this.opponent.name].looses++;

                this.gameCompleted = true;
                this.opponent.gameCompleted = true;
                this.switchRoom(null);
              }
            }
            console.log(`[${moment().format('HH:mm:ss')}] →  ${this.name} just fired at ${this.opponent.name}'s field ${field} (and hit)`);

            this.socket.emit('shotHit', { field, wasItYourShot: true });
            this.opponent.socket.emit('shotHit', { field, wasItYourShot: false });
          }
        });
      }

      // Leaving battle
      if ((this.room !== null) && (this.room.startsWith('battle-'))) {
        if (!this.gameCompleted) {
          this.opponent.socket.emit('opponentLeft', null);
          stats[this.opponent.name].wins++;
          stats[this.name].looses++;
        }
        this.socket.removeAllListeners('draftCompleted');
        this.socket.removeAllListeners('shotFired');
      }

      this.room = room;
      if (room !== null)
        this.socket.join(room);
    },

    /**
     * Declines all pending challenges from other players
     * @return {undefined}
     */
    this.declineAllChallenges = () => {
      for (let client of this.challengedBy)
        client.socket.emit('gameChallengeDecline', this.name);
    }
}

Client.nationalities = ["CZ", 'DE']; // the two competing sides

/**
 * Finds client by its name in a room and returns him
 * @param  {string} clientName name of a desired client
 * @param  {string} room       in which room are we looking for
 * @return {Client}            returns him as an object if found, null otherwise
 */
Client.clientByName = function(clientName, room) {
  for (let client of clients)
    if (clientName === client.name)
      return client.room === room ? client : null;
  return null;
};

const clients = []; // list of all conected Client instances

const battles = {}; // list of all battle rooms

const stats = {
  /* Example content
  Boy1: {
    wins: 4,
    looses: 5,
    shotsFired: 16,
    shotsFiredHit: 4,
    shotsTaken: 14,
    shotsTakenHit: 3
  },
  Boy2: {
    wins: 5,
    looses: 4,
    shotsFired: 14,
    shotsFiredHit: 3,
    shotsTaken: 16,
    shotsTakenHit: 4
  }
  */
};

app.get('/stats', function(req, res) {
  res.sendFile(__dirname + '/stats/stats.html');
});

app.get('/api/stats', function(req, res) {
  res.header("Content-Type", "text/json");
  res.send(JSON.stringify(stats));
});

app.get('/stats.css', function(req, res) {
  res.sendFile(__dirname + '/stats/stats.css');
});

app.get('*', function(req, res) {
  res.sendFile(__dirname + '/index.html');
});


io.on('connection', function(socket) {
  // Initialize new client and add himto into global list of clients
  let clientCurr = new Client(socket);
  clients.push(clientCurr);

  /*
  Set name and nationality of current the client
  Requied data parameters are name and nationality
  Emit profileSet on success, profileError on some error (like the name is already taken)
  */
  socket.on('setProfile', function(data) {
    // Test if data has all requied keys
    if (!(data instanceof Object)) {
      socket.emit('profileError', 'setProfile data must be a dictionary');
      return;
    }
    if (!('name' in data)) {
      socket.emit('profileError', 'setProfile data must contain a "name" key');
      return;
    }
    if (!('nationality' in data)) {
      socket.emit('profileError', 'setProfile data must contain a "nationality" key');
      return;
    }

    // Check if sent nationality is valid
    if (Client.nationalities.indexOf(data.nationality) === -1) {
      socket.emit('profileError', 'Possible nationalities are ' + Client.nationalities.join(' or '));
      return;
    }

    // If this client is already set and has the same name, just reset him
    if ((clientCurr.name !== null) && (clientCurr.name !== data.name) && (socket === client.socket) && (client.room === null)) {
      // Check if name is not already taken
      for (client of clients)
        if ((client.name !== null) && (client.name === data['name'])) {
          socket.emit('profileError', 'Name is already taken');
          return;
        }
    }

    console.log(`[${moment().format('HH:mm:ss')}] →  ${data['name']} (${data['nationality']}) joined the lobby`);

    // Set client's data and emit success
    clientCurr.name = data['name'];
    if (!(clientCurr.name in stats))
      stats[clientCurr.name] = {
        wins: 0,
        looses: 0,
        shotsFired: 0,
        shotsFiredHit: 0,
        shotsTaken: 0,
        shotsTakenHit: 0
      };
    clientCurr.nationality = data['nationality'];
    clientCurr.dataSet = true;
    socket.emit('profileSet', 'You may proceed');
    clientCurr.switchRoom('lobby');
    clientCurr.sendClientsList();
  }); // End of .on('setProfile' event

  /*
  It is sad, but the socket left us alone. Let's tell everybody the name of the One who left our party. (Or say nothing, if we didn't know his name)
  */
  socket.on('disconnect', function() {
    console.log(`[${moment().format('HH:mm:ss')}] ←  ${clientCurr.name !== null ? clientCurr.name : 'undefined'} left`);
    clientCurr.switchRoom(null);
    clients.splice(clients.indexOf(clientCurr), 1); // remove client from array. He is dead for me now.
  });
});

http.listen(PORT, function() {
  console.log(`[${moment().format('HH:mm:ss')}] →  game server has gone live on localhost:${PORT}`);
});
