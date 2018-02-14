const app = require('express')();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const moment = require('moment');
const uuid = require('uuid/v4');

const PORT = 3000; // server port

const Client = function(socket) {
  this.name = null; // unique name of the client
  this.socket = socket; // socket he has connected from
  this.nationality = null; // One of the Client.nationalities's items
  this.room = null; // null, lobby
  this.opponent = null; // who wants to test strength again this little fellow?
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
    if (room ==== 'lobby') {
      io.sockets.in(room).emit('clientJoinedLobby', {
        'name': this.name,
        'nationality': this.nationality
      });

      // Clients wants to challenge somebody
      this.socket.on('gameChallenge', (opponentName) => {
        let opponent = Client.clientByName(opponentName, room);
        if (opponent === null){
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
        do{
          battleRoomName = "battle-" + uuid();
        } while(battleRoomName in Object.keys(battles));
        battles[battleRoomName] = [this, opponent];
        this.switchRoom(battleRoomName);
        opponent.switchRoom(battleRoomName);
        io.sockets.in(battleRoomName).emit('gameStarting', [{
          'name': this.name,
          'nationality': this.nationality
        }, {
          'name': opponent.name,
          'nationality': opponent.nationality
        }]);
      });
    }

    // Leaving the lobby
    if (this.room === 'lobby') {
      // this.socket.off('gameChallenge'); // FIXME Why does this not work?
      io.sockets.in(this.room).emit('clientLeftLobby', {
        'name': this.name,
        'nationality': this.nationality
      });
      this.declineAllChallenges();
    }
    this.room = room;
    if (room !== null)
      this.socket.join(room);
  },

  /**
   * Declines all pending challenges from other players
   * @return {undefined}
   */
  this.declineAllChallenges = ()=>{
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

const battles = {};

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

    // Check if name is not already taken
    for (client of clients)
      if ((client.name !== null) && (client.name === data['name'])) {
        socket.emit('profileError', 'Name is already taken');
        return;
      }

    console.log(`[${moment().format('HH:mm:ss')}] →  ${data['name']} (${data['nationality']}) joined`);

    // Set client's data and emit success
    clientCurr.name = data['name'];
    clientCurr.nationality = data['nationality'];
    clientCurr.dataSet = true;
    socket.emit('profileSet', 'You may proceed');
    clientCurr.switchRoom('lobby');
    clientCurr.sendClientsList();

    console.log(`[${moment().format('HH:mm:ss')}] -- online: ${clients
      .map(client => client.name)
      .filter(client => client !== null)
      .join(', ')}\n`);
  }); // End of .on('setProfile' event

  /*
  It is sad, but the socket left us alone. Let's tell everybody the name of the One who left our party. (Or say nothing, if we didn't know his name)
  */
  socket.on('disconnect', function() {
    console.log(clientCurr.name !== null ? `[${moment().format('HH:mm:ss')}] ←  ${clientCurr.name} left` : '←  undefined left');
    clientCurr.switchRoom(null);
    clients.splice(clients.indexOf(clientCurr), 1); // remove client from array. He is dead for me now.
    console.log(`[${moment().format('HH:mm:ss')}] -- online: ${clients
      .map(client => client.name)
      .filter(client => client !== null)
      .join(', ')}\n`);
  });
});

http.listen(PORT, function() {
  console.log(`Live on http://localhost:${PORT}`);
});
