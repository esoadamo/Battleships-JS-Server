const app = require('express')();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const moment = require('moment');

const PORT = 3000;

const Client = function(socket) {
  this.name = null;
  this.socket = socket;
  this.nationality = null; // CZ or DE
  this.room = null;
  this.opponent = null;

  /**
   *  Emits clientĹist with list of all current clients in lobby
   */
  this.sendClientsList = () => {
    let emittedData = []
    for (let client of clients)
      if ((client !== this) &&(client.room === 'lobby'))
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
    if (room === 'lobby') // entering lobby
      io.sockets.in(room).emit('clientJoinedLobby', {
        'name': this.name,
        'nationality': this.nationality
      });
    if (this.room == 'lobby') // leaving lobby
      io.sockets.in(this.room).emit('clientLeftLobby', {
        'name': this.name,
        'nationality': this.nationality
      });
    this.room = room;
    if (room !== null)
      this.socket.join(room);
  }
}

Client.nationalities = ["CZ", 'DE'];

const clients = [];

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
  });

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
