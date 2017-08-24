const ipc = require('node-ipc')

const childProcess = require('child_process');
const EventEmitter = require('events');

const execArgsProcessor = {
    debugOptionPattern: /^(--inspect|--debug|--debug-(brk|port))(=\d+)?$/,
    offset: 1,

    map(execArgv) {
        let debugPort = 0;
        return execArgv.map(option => {
            const debugOption = option.match(this.debugOptionPattern);
            if (!debugOption) return option;
            if (debugPort === 0) debugPort = process.debugPort + this.offset++;
            return debugOption[1] + '=' + debugPort;
        });
    }
};

var $dataTransport


class WorkerProcess extends EventEmitter {
    constructor(modulePath, { stopTimeout }) {
        super();
        var self = this
        
        const child = childProcess.fork(require.resolve('./child-loader'), {
            env: process.env,
            cwd: process.cwd(),
            execArgv: execArgsProcessor.map(process.execArgv),
            stdio: [0, 1, 2, 'pipe', 'ipc']
        });
        
        const ID = ('nwp' + child.pid)
        
        ipc.config.id = ID
        ipc.serve()
        ipc.server.on('start', function () {
            console.log('started server')
            self.child = child;
            self.stopTimeout = stopTimeout;

            child.on('error', error => console.error(error));

            // this instance is not usable from this moment, so forward the exit event
            child.once('exit', code => self.emit('exit', code));

            // report readiness on a first message received from the child
            
            // pass all the information needed to spin up the child process
            child.send({ cmd: 'start', data: { modulePath } });
          });
        
        ipc.server.on('connect', function (socket) {
            $socket = socket
            $dataTransport = ipc
            self.emit('ready')
        })

        ipc.server.on('app.message', function (data, socket) {
            console.log('server got message', data)
            self.emit(data.message)
        })
        ipc.server.start()
    }

    /**
     * Stops the worker process. It results in a trigger of an 'exit' event.
     */
    exit() {
        // watchdog the stop progress and force the
        // child to exit if it all takes too long
        const timer = setTimeout(() => this.child.kill('SIGKILL'), this.stopTimeout);
        this.child.once('exit', () => clearTimeout(timer));

        // politely ask the child to stop
        this.child.send({ cmd: 'exit' });
    }

    /**
     * Processed the request object. It results in a trigger of a 'message'
     * event with a response object as a payload, when the result is ready.
     *
     * @param {Request} request
     */
    handle(request) {

        $dataTransport.emit($socket, 'app.message', {message: request});
    }
}

module.exports = WorkerProcess;