import { createServer } from 'http'
import { Server } from 'socket.io'

const httpServer = createServer((req, res) => {
  if (req.url === '/ping') {
    res.writeHead(200)
    res.end('pong')
    return
  }
  res.writeHead(404)
  res.end()
})

const io = new Server(httpServer, {
  cors: { origin: '*' },
})

let connectedUsers = []

io.on('connection', (socket) => {
  console.log('接続:', socket.id)
  connectedUsers.push(socket.id)

  const others = connectedUsers.filter((id) => id !== socket.id)
  if (others.length > 0) {
    socket.emit('peer-available', others[0])
    io.to(others[0]).emit('peer-available', socket.id)
  }

  socket.on('offer', ({ to, offer }) => {
    io.to(to).emit('offer', { from: socket.id, offer })
  })

  socket.on('answer', ({ to, answer }) => {
    io.to(to).emit('answer', { from: socket.id, answer })
  })

  socket.on('ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('ice-candidate', { from: socket.id, candidate })
  })

  socket.on('disconnect', () => {
    console.log('切断:', socket.id)
    connectedUsers = connectedUsers.filter((id) => id !== socket.id)
  })
})

const PORT = process.env.PORT || 3001
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`シグナリングサーバー起動中： port ${PORT}`)
})