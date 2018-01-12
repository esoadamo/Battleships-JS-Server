const app = require('express')();
const http = require('http').Server(app);
const io = require('socket.io')(http);

const PORT = 3000;

const Client = function(socket) {
  this.name = null;
  this.socket = socket;
  this.alleigance = null; // CZ or DE
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
          'alleigance': client.alleigance
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
      io.sockets.in(room).emit('clientEnteredLobby', {
        'name': this.name,
        'alleigance': this.alleigance
      });
    if (this.room == 'lobby') // leaving lobby
      io.sockets.in(this.room).emit('clientLeavedLobby', {
        'name': this.name,
        'alleigance': this.alleigance
      });
    this.room = room;
    if (room !== null)
      this.socket.join(room);
  }
}
Client.alleigances = ["CZ", 'DE'];

const clients = [];

app.get('*', function(req, res) {
  res.sendFile(__dirname + '/index.html');
});

io.on('connection', function(socket) {
  console.log('A wild user has appeared');

  // Initialize new client and add himto into global list of clients
  let clientCurr = new Client(socket);
  clients.push(clientCurr);

  /*
  Set name and alleigance of current the client
  Requied data parameters are name and alleigance
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
    if (!('alleigance' in data)) {
      socket.emit('profileError', 'setProfile data must contain a "alleigance" key');
      return;
    }

    // Check if sent alleigance is valid
    if (Client.alleigances.indexOf(data.alleigance) === -1) {
      socket.emit('profileError', 'Possible alleigances are ' + Client.alleigances.join(' or '));
      return;
    }

    // Check if name is not already taken
    for (client of clients)
      if ((client.name !== null) && (client.name === data['name'])) {
        socket.emit('profileError', 'Name is already taken');
        return;
      }

    // Set client's data and emit success
    clientCurr.name = data['name'];
    clientCurr.alleigance = data['alleigance'];
    clientCurr.dataSet = true;
    socket.emit('profileSet', 'You may proceed');
    clientCurr.switchRoom('lobby');
    clientCurr.sendClientsList();
  });

  socket.on('disconnect', function() {
    console.log(clientCurr.name !== null ? `${clientCurr.name} has left us for now` : 'some random trespasser went away');
    clientCurr.switchRoom(null);
    clients.splice(clients.indexOf(clientCurr), 1); // remove client from array. He is dead for me now.
  });
});

http.listen(PORT, function() {
  console.log(`server up and running on http://localhost:${PORT}`);
});
