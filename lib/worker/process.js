const net = require ('net')
const xpipe = require('xpipe');
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
        const PIPE_PATH = xpipe.eq('/tmp/nwp' + child.pid)
        
        var server = net.createServer(function (stream) {

            $dataTransport = stream;
            
            stream.on('data', function (data) {
                let retObj = JSON.parse(data)
                self.emit('message', retObj)
            });

            stream.on('end', function () {
                server.close();
            });
        });

        server.on('close', function () {
        })

        server.listen(PIPE_PATH, function () {
            self.child = child;
            self.stopTimeout = stopTimeout;

            child.on('error', error => console.error(error));

            // this instance is not usable from this moment, so forward the exit event
            child.once('exit', code => self.emit('exit', code));

            // report readiness on a first message received from the child
            // process (as it means that the child has loaded all the stuff
            // into a memory and is ready to handle the calls)
            child.once('message', () => {
              self.emit('ready')
            });

            // pass all the information needed to spin up the child process
            child.send({ cmd: 'start', data: { modulePath } });
        })
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
        let stringy = JSON.stringify(request)
        $dataTransport.write(stringy);
    }
}

module.exports = WorkerProcess;