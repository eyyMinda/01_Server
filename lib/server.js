import http from 'http';
import os from 'os';
import { utils } from './utils.js';
import { file } from './file.js'
import { router } from "./router.js";
import config from '../config.js';
import { StringDecoder } from 'string_decoder';
import APIaccount from '../api/account.js';
import APItoken from '../api/token.js';
const server = {};

server.httpServer = http.createServer((req, res) => {
    const baseURL = `http${req.socket.encryption ? 's' : ''}://${req.headers.host}/`;
    const parsedURL = new URL(req.url, baseURL);
    const httpMethod = req.method.toLowerCase();
    const parsedPathName = parsedURL.pathname;
    const trimmedPath = parsedPathName.replace(/^\/+|\/+$/g, '');   // regex

    const fileExtension = utils.fileExtension(trimmedPath);
    const textFileExtensions = ['css', 'js', 'svg', 'webmanifest', 'txt'];
    const binaryFileExtensions = ['jpg', 'png', 'ico'];
    const isTextFile = textFileExtensions.includes(fileExtension);
    const isBinaryFile = binaryFileExtensions.includes(fileExtension);
    const isAPI = trimmedPath.split('/')[0] === 'api';
    const isPage = !isTextFile && !isBinaryFile && !isAPI;
    const maxAge = config.cache.period[fileExtension] ?? config.cache.default

    const mimes = {
        html: 'text/html',
        css: 'text/css',
        js: 'text/javascript',
        svg: 'image/svg+hml',
        png: 'image/png',
        jpg: 'image/jpeg',
        ico: 'image/x-icon',
        woff2: 'font/woff2',
        woff: 'font/woff',
        ttf: 'font/ttf',
        otf: 'font/otf',
        eot: 'aplication',
        webmanifest: 'application/manifest+json',
        pdf: 'application/json',
        json: 'application/json'
    };
    const decoder = new StringDecoder('utf-8');
    let buffer = '';

    req.on('data', (data) => { buffer += decoder.write(data); })
    req.on('end', async () => {
        buffer += decoder.end();
        const [parsedErr, parsedContent] = utils.parseJSONtoObject(buffer)
        let responseContent = '';
        const dataForHandlers = {
            baseURL,
            trimmedPath,
            httpMethod,
            payload: parsedErr ? {} : parsedContent,
            searchParams: parsedURL.searchParams,
            user: {
                isLoggedIn: false,
                email: '',
                platform: os.platform(),
                browser: utils.detectedBrowser(req.headers['user-agent']),
                ipaddress: req.socket.remoteAddress,
            },
            cookies: utils.parseCookies(req.headers.cookie),
        }

        dataForHandlers.user.isLoggedIn = await APItoken._innerMethods.verify(dataForHandlers.cookies['login-token']);

        if (isTextFile) {
            const [readErr, readMsg] = await file.readPublic(trimmedPath);
            if (readErr) { res.writeHead(404); }
            else {
                res.writeHead(200, {
                    'Content-Type': mimes[fileExtension] || mimes.html,
                    'Cache-Control': `max-age=${maxAge}`,
                });
            }
            responseContent = readMsg;
        }
        if (isBinaryFile) {
            const [readErr, readMsg] = await file.readPublicBinary(trimmedPath)
            if (readErr) { res.writeHead(404); }
            else {
                res.writeHead(200, {
                    'Content-Type': mimes[fileExtension] || mimes.html,
                    'Cache-Control': `max-age=${maxAge}`,
                });
            }
            responseContent = readMsg;
        }
        if (isAPI) {
            const APIroute = trimmedPath.split('/')[1];
            if (server.API[APIroute] && server.API[APIroute][APIroute]) {
                const APIhandler = server.API[APIroute][APIroute];

                function apiCallbackFunc(statusCode, payload, headers = {}) {
                    statusCode = typeof statusCode === 'number' ? statusCode : 200;
                    responseContent = typeof payload === 'string' ? payload : JSON.stringify(payload);

                    res.writeHead(statusCode, {
                        'Content-Type': mimes.json,
                        ...headers,
                    })
                }
                await APIhandler(dataForHandlers, apiCallbackFunc);
            } else {
                res.writeHead(404, { 'Content-Type': mimes.json, })
                responseContent = JSON.stringify({ msg: 'No such API endpoint found' });
            }
        }
        if (isPage) {
            const pageClass = router.getRoute(dataForHandlers);
            const pageObj = new pageClass(dataForHandlers);
            const [pageHTML, pageHeaders] = pageObj.render();
            responseContent = pageHTML;

            res.writeHead(200, { 'Content-Type': mimes.html, 'Cache-Control': 'max-age=0', ...pageHeaders, })
        }
        return res.end(responseContent);
    })
})

server.API = {
    'account': APIaccount,
    'token': APItoken,
}

server.init = () => {
    server.httpServer.listen(config.httpPort);
    console.log(`Server is running at http://localhost:${config.httpPort}`)
}

export { server };