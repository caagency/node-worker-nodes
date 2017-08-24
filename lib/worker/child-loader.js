const ipc = require('node-ipc');

const { Request, Response } = require('./message');

let $module;
let $cmdTransport = process;

function setupModule({ modulePath }) {
    // load target module
    $module = require(modulePath);

    let myIpc = new ipc.IPC
    let $dataTransport;

    function handleCall(requestData) {
        const dataObj = requestData
        const request = new Request(dataObj);
        const response = Response.from(request);

        const args = request.args || [];
        const target = request.method === '__module__' ? $module : $module[request.method];
        const func = typeof target == 'function' ? target.bind($module) : null;

        return new Promise(resolve => {
            if (!func) throw new TypeError(`${request.method} is not a function`);
            resolve(func(...args));
        })
            .then(result => {
                let respData = { message: result }
                $dataTransport.emit('app.message', respData);
            })
            .catch(err => {
                const error = {
                    type: err.constructor.name,
                    message: err.message,
                    stack: err.stack
                };

                Object.keys(err).forEach(key => error[key] = err[key]);
                response.error = error;
                let respData = { message: response }
                $dataTransport.emit('app.message', respData);
            });
    }

    // setup data transport channel
    const ID = ('nwp' + process.pid)

    myIpc.config.id = 'c' + ID
    myIpc.config.silent = true

    myIpc.connectTo(ID, function () {
        myIpc.of[ID].on('app.message', function (data) {
            handleCall(data.message)
        })
        myIpc.of[ID].on('connect', function () {
            $dataTransport = myIpc.of[ID]
            $cmdTransport.send('ready')
        })
    })
}



$cmdTransport.on('message', function ({ cmd = 'call', data }) {
    switch (cmd) {
        case 'start':
            return setupModule(data);
        case 'exit':
            return process.exit(0);
    }
});