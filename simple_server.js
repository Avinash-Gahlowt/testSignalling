const fs = require('fs');
const http = require('http');
const  express=require('express')
const app =express()
app.get("/",(req,res)=>{
    res.sendFile("e:/test Signalling server/index.html")

})
app.listen(8443)

const WebSocket = require('ws');
let uid = (2500).toString()
class WebRTCSimpleServer {
    constructor(options) {
        this.peers = new Map(); 
        // {uid: [ws, remote_address, 'session' or room_id or null]}
        this.sessions = new Map();
         // {caller_uid: callee_uid, callee_uid: caller_uid}
        this.rooms = new Map(); 
        // {room_id: Set[peer1_id, peer2_id, peer3_id, ...]}

        this.addr = options.addr || '127.0.0.1';
        this.port = options.port || 8443;
        this.keepaliveTimeout = options.keepaliveTimeout || 30;
        this.certPath = options.certPath || __dirname;
        //this.disableSSL = options.disableSSL || false;
        this.disableSSL = true;
        this.healthPath = options.health || '/health';
        this.certRestart = options.certRestart || false;
        this.certMtime = -1;
    }
        // Define a simple waitForMessage function to resolve the error
         async waitForMessage(ws,timeout) {
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    reject(new Error('Timeout waiting for message'));
                },timeout);
    
                ws.once('message', (message) => {
                    clearTimeout(timer);
                    resolve(message)
                });
            });
        }
    async healthCheck(path, requestHeaders) {
        if (path === this.healthPath) {
            return { status: 200, headers: [], body: 'OK\n' };
        }
        return null;
    }

    async recvMsgPing(ws, raddr) {
        let msg = null;
        while (msg === null) {
            try {
                msg = await this.waitForMessage(ws, this.keepaliveTimeout);
            } catch (error) {
               // console.log(`Sending keepalive ping to ${raddr} in recv`);
                ws.ping();
            }
        }
        return msg;
    }

    async cleanupSession(uid) {
        if (this.sessions.has(uid)) {
            const otherId = this.sessions.get(uid);
            this.sessions.delete(uid);
            console.log(`Cleaned up ${uid} session`);
            if (this.sessions.has(otherId)) {
                this.sessions.delete(otherId);
                console.log(`Also cleaned up ${otherId} session`);
                if (this.peers.has(otherId)) {
                    console.log(`Closing connection to ${otherId}`);
                    const [wso, oaddr, _] = this.peers.get(otherId);
                    this.peers.delete(otherId);
                    await wso.close();
                }
            }
        }
    }

    async cleanupRoom(uid, roomId) {
        const roomPeers = this.rooms.get(roomId);
        if (!roomPeers || !roomPeers.has(uid)) {
            return;
        }
        roomPeers.delete(uid);
        for (const pid of roomPeers) {
            const [wsp, paddr, _] = this.peers.get(pid);
            const msg = `ROOM_PEER_LEFT ${uid}`;
            console.log(`room ${roomId}: ${uid} -> ${pid}: ${msg}`);
            await wsp.send(msg);
        }
    }

    async removePeer(uid) {
        await this.cleanupSession(uid);
        if (this.peers.has(uid)) {
            const [ws, raddr, _] = this.peers.get(uid);
            if (ws) {
                this.peers.delete(uid);
                await ws.close();
                console.log(`Disconnected from peer ${uid} at ${raddr}`);
            }
        }
    }

    async connectionHandler(ws, uid=2500) {
        const raddr = ws._socket.remoteAddress;
        let peerStatus = null;
        this.peers.set(uid, [ws, raddr, peerStatus]);
        console.log(`Registered peer ${uid} at ${raddr}`);

        while (true) {
            try {
                const msg = await this.recvMsgPing(ws, raddr);
                peerStatus = this.peers.get(uid)[2];

                if (peerStatus !== null) {
                    if (peerStatus === 'session') {
                        const otherId = this.sessions.get(uid);
                        if (this.peers.has(otherId)) {
                            const [wso, oaddr, status] = this.peers.get(otherId);
                            if (status === 'session') {
                                console.log(`${uid} -> ${otherId}: ${msg}`);
                                await wso.send(msg);
                            }
                        }
                    } else if (peerStatus) {
                        if (msg.startsWith('ROOM_PEER_MSG')) {
                            const [, otherId, message] = msg.split(' ', 3);
                            if (this.peers.has(otherId)) {
                                const [wso, oaddr, status] = this.peers.get(otherId);
                                if (status === peerStatus) {
                                    const newMsg = `ROOM_PEER_MSG ${uid} ${message}`;
                                    console.log(`room ${peerStatus}: ${uid} -> ${otherId}: ${newMsg}`);
                                    await wso.send(newMsg);
                                }
                            }
                        } else if (msg === 'ROOM_PEER_LIST') {
                            const roomPeers = [...this.rooms.get(peerStatus)];
                            roomPeers.splice(roomPeers.indexOf(uid), 1);
                            const roomPeerList = roomPeers.join(' ');
                            const response = `ROOM_PEER_LIST ${roomPeerList}`;
                            console.log(`room ${peerStatus}: -> ${uid}: ${response}`);
                            await ws.send(response);
                        } else {
                            await ws.send('ERROR invalid msg, already in room');
                        }
                    } else {
                        throw new Error(`Unknown peer status ${peerStatus}`);
                    }
                } else if (msg.startsWith('SESSION')) {
                    const [, calleeId] = msg.split(' ', 2);
                    if (this.peers.has(calleeId)) {
                        const calleeStatus = this.peers.get(calleeId)[2];
                        if (calleeStatus === null) {
                            await ws.send('SESSION_OK');
                            const wsc = this.peers.get(calleeId)[0];
                            console.log(`Session from ${uid} (${raddr}) to ${calleeId} (${wsc._socket.remoteAddress})`);
                            this.peers.get(uid)[2] = 'session';
                            this.sessions.set(uid, calleeId);
                            this.peers.get(calleeId)[2] = 'session';
                            this.sessions.set(calleeId, uid);
                        } else {
                            await ws.send('ERROR peer busy');
                        }
                    } else {
                        await ws.send('ERROR peer not found');
                    }
                } else if (msg.startsWith('ROOM')) {
                    const [, roomId] = msg.split(' ', 2);
                    if (this.rooms.has(roomId)) {
                        if (peerStatus === null) {
                            await ws.send(`ROOM_OK ${[...this.rooms.get(roomId)].join(' ')}`);
                            this.peers.get(uid)[2] = roomId;
                            this.rooms.get(roomId).add(uid);
                            for (const pid of this.rooms.get(roomId)) {
                                if (pid === uid) {
                                    continue;
                                }
                                const [wsp, paddr, _] = this.peers.get(pid);
                                const roomMsg = `ROOM_PEER_JOINED ${uid}`;
                                console.log(`room ${roomId}: ${uid} -> ${pid}: ${roomMsg}`);
                                await wsp.send(roomMsg);
                            }
                        } else {
                            await ws.send('ERROR you are already in a session, reconnect to the server to start a new session, or use a ROOM for multi-peer sessions');
                        }
                    } else {
                        await ws.send('ERROR invalid room id');
                    }
                } else {
                    console.log(`Ignoring unknown message ${msg} from ${uid}`);
                }
            } catch (error) {
                console.error(`Error in connectionHandler: ${error.message}`);
                break;
            }
        }
    }


    async helloPeer(ws) {
        const raddr = ws._socket.remoteAddress;
        const hello = await this.waitForMessage(ws);
       /* const [greeting, uid] = hello.split(' ', 2);
        if (greeting !== 'HELLO') {
            ws.close(1002, 'invalid protocol');
            throw new Error(`Invalid hello from ${raddr}`);
        }
        if (!uid || this.peers.has(uid) || uid.split(' ').length > 1) {
            ws.close(1002, 'invalid peer uid');
            throw new Error(`Invalid uid ${uid} from ${raddr}`);
        }*/
        await ws.send('HELLO');
        return uid;
    }
  /*  async helloPeer(ws) {
        const raddr = ws._socket.remoteAddress;
        try {
            const hello = await this.waitForMessage(ws);
            if (typeof hello === 'string') {
                const [greeting, uid] = hello.split(' ', 2);
                if (greeting === 'HELLO' && typeof uid === 'string') {
                    if (!uid || this.peers.has(uid) || uid.split(' ').length > 1) {
                        ws.close(1002, 'invalid peer uid');
                        throw new Error(`Invalid uid ${uid} from ${raddr}`);
                    }
                    await ws.send('HELLO');
                    return uid;
                }
            }
            ////ws.close(1002, 'invalid protocol');
          ////  throw new Error(`Invalid hello from ${raddr}`);
        } catch (error) {
            console.error(`Error in helloPeer: ${error.message}`);
            ws.close();
            throw error;
        }
    }*/
    
    getSSLCerts() {
        let chainPem, keyPem;
        if (this.certPath.includes('letsencrypt')) {
            chainPem = `${this.certPath}/fullchain.pem`;
            keyPem = `${this.certPath}/privkey.pem`;
        } else {
            chainPem = `${this.certPath}/cert.pem`;
            keyPem = `${this.certPath}/key.pem`;
        }
        return [chainPem, keyPem];
    }

    getSSLContext() {
        if (this.disableSSL) {
            return null;
        }
        console.log(`Using TLS with keys in ${this.certPath}`);
        const [chainPem, keyPem] = this.getSSLCerts();
        const sslContext = {
            cert: fs.readFileSync(chainPem),
            key: fs.readFileSync(keyPem),
        };
        return  http.createServer({sslContext});
    }

    async run() {
        const sslContext = this.getSSLContext();
        
        //const server = sslContext? http.createServer(): http.createServer((req,res)=>{});
        const server = http.createServer((req,res)=>{ });
     
        console.log(`Listening on http://${this.addr}:${this.port}`);
  
        
        const wss = new WebSocket.Server({noServer:true});

        server.on('upgrade', (request, socket, head) => {
            wss.handleUpgrade(request, socket, head, (ws) => {
                wss.emit('connection', ws, request);
            });
        });

        wss.on('connection', (ws, request) => {
            const raddr = request.socket.remoteAddress;
            console.log(`Connected to ${raddr}`);
            this.helloPeer(ws)
                .then((uid) => this.connectionHandler(ws, uid))
                .catch((error) => {
                    console.error(`Error in connection: ${error.message}`);
                    ws.close();
                })
                .finally(() => this.removePeer(uid));
        });
        const checkServerNeedsRestart = async () => {
            if (!this.certRestart) return;
            while (true) {
                await new Promise((resolve) => setTimeout(resolve, 10000));
                if (this.checkCertChanged()) {
                    console.log('Certificate changed, stopping server...');
                    this.stop();
                    return;
                }
            }
        };

        this.exitFuture = null;

        try {
            this.exitFuture = new Promise(() => {});
            checkServerNeedsRestart();
            server.listen(this.port, this.addr);
            console.log('Server is running...');
            await this.exitFuture;
            this.exitFuture = null;
        } finally {
            console.log('Stopped.');
        }
    }

    stop() {
        if (this.exitFuture) {
            console.log('Stopping server...');
            this.exitFuture.resolve();
        }
    }

    checkCertChanged() {
        const [chainPem, keyPem] = this.getSSLCerts();
        const mtime = Math.max(fs.statSync(keyPem).mtimeMs, fs.statSync(chainPem).mtimeMs);
        if (this.certMtime < 0) {
            this.certMtime = mtime;
            return false;
        }
        if (mtime > this.certMtime) {
            this.certMtime = mtime;
            return true;
        }
        return false;
    }
}

const options = {
    addr: '127.0.0.1',
    port: 8443,
    keepaliveTimeout: 30,
    certPath: __dirname,
    disableSSL: true,
    health: '/health',
    certRestart: false,
};

console.log('Starting server...');

(async () => {
    while (true) {
        const r = new WebRTCSimpleServer(options);
        await r.run();
        console.log('Restarting server...');
    }
})();