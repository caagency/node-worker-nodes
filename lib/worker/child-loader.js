const net = require('net');
const xpipe = require('xpipe')

const { Request, Response } = require('./message');
const Transport = require('./transport');

let $module;
let $cmdTransport = process;
let $dataTransport;

function setupModule({ modulePath }) {
    // load target module
    $module = require(modulePath);

    // setup data transport channel
    const PIPE_PATH = xpipe.eq('/tmp/nwp' + process.pid)

    var client = net.connect(PIPE_PATH, function () {
        client.on('data', function (data) {
            handleCall(data)
        });

        $dataTransport = client

        // report readiness
        $cmdTransport.send('ready');
    })
}

function handleCall(requestData) {
    const dataObj = JSON.parse(requestData)
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
            response.setResult(result);
            let respData = JSON.stringify(response)
            $dataTransport.write(respData);
        })
        .catch(err => {
            const error = {
                type: err.constructor.name,
                message: err.message,
                stack: err.stack
            };

            Object.keys(err).forEach(key => error[key] = err[key]);
            response.error = error;
            let respData = JSON.stringify(response)
            $dataTransport.write(respData);
        });
}

$cmdTransport.on('message', function ({ cmd = 'call', data }) {
    switch (cmd) {
        case 'start':
            return setupModule(data);
        case 'exit':
            return process.exit(0);
    }
});