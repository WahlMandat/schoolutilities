// import external modules
const express = require('express');
const url = require('url');
const fs = require('fs');
const fetch = require('node-fetch');
const { OK, CREATED, NO_CONTENT, BAD_REQUEST, NOT_FOUND, METHOD_NOT_ALLOWED } = require('http-status-codes');
const { sort } = require('mathjs');
const { serverConfiguration, save } = require('../misc/utils.js');
const { langs } = require('../misc/languages.js');
const { env } = require('process');
let userCache = {};

// create router
const router = express.Router();

let languageData;
try {
    languageData = require('../datastore/language.json');
} catch (error) {
    languageData = [];
}

let configData;
try {
    configData = require('../datastore/configs.json');
} catch (error) {}

setInterval(function clearCache() {
    for (key in userCache) {
        if (userCache[key].date < Date.now() - 2000) {
            delete userCache[key];
        }
    }
}, 3000);

router.post('/languagejson', (req, res) => {
    const language = req.body.language;
    if (isLanguageSupported(language)) {
        res.status(OK).json(languageData.languages[language]);
    } else {
        res.status(OK).json(languageData.languages['en']);
    }
});

router.post('/serverjson', (req, res) => {
    const token = req.body.token;
    let allServers = [];
    fetch('https://discord.com/api/users/@me/guilds', {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
        },
    })
        .then((discordRes) => discordRes.json())
        .then((servers) => {
            userCache[token] = {
                servers: servers,
                date: Date.now(),
            };
            configData.forEach((server) => {
                let foundServer = servers.find((element) => element.id == server.guildId);
                if (foundServer) {
                    allServers.push(foundServer);
                }
            });
            if (allServers) {
                res.status(OK).json(betterSort(servers));
            } else {
                res.status(NOT_FOUND);
            }
        });
});
router.get('/discordloginurl', (req, res) => {
    res.send(process.env.DISCORD_LOGIN_URL);
});
router.post('/saveconfig', async (req, res) => {
    const token = req.body.token;
    let servers;
    let serverConfig = req.body.serverConfig;
    const id = serverConfig.guildId;
    let discordRes = await fetch('https://discord.com/api/users/@me/guilds', {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });
    //TODO Serverside Error-Handling
    servers = await discordRes.json();
    if (servers) {
        userCache[token] = {
            servers: servers,
            date: Date.now(),
        };
        if (getSharedAdminServerIDs(getSharedAdminServers(servers)).includes(id)) {
            let serverConfigIndex = configData.findIndex((serverData) => serverData.guildId == id);
            configData[serverConfigIndex] = serverConfig;
            save('./datastore/configs.json', JSON.stringify(configData));
            res.status(OK);
        } else {
            res.status(NOT_FOUND);
        }
    }
});
router.get('/supportedlanguages', async (req, res) => {
    let supportedLanguages = langs;
    if (supportedLanguages) {
        res.status(OK).json(supportedLanguages);
    } else {
        res.status(NOT_FOUND);
    }
});
router.post('/serverinformation', async (req, res) => {
    const token = req.body.token;
    const id = req.body.id;
    let serverinformation = {
        guild: null,
        roles: null,
        channels: null,
    };
    let servers;
    if (userCache[token]) {
        servers = userCache[token].servers;
    } else {
        let discordRes = await fetch('https://discord.com/api/users/@me/guilds', {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
        servers = await discordRes.json();
        userCache[token] = {
            servers: servers,
            date: Date.now(),
        };
    }
    if (servers) {
        let sharedAdminServer = getSharedAdminServers(servers);
        serverinformation.guild = servers.find((element) => element.id == id);
        if (sharedAdminServer.find((element) => element.id == id)) {
            let roles = await fetch(`https://discord.com/api/guilds/${id}/roles`, {
                method: 'GET',
                headers: {
                    Authorization: `Bot ${process.env.TOKEN}`,
                },
            });
            roles = await roles.json();
            if (roles) {
                serverinformation.roles = roles;
            }
            let channels = await fetch(`https://discord.com/api/guilds/${id}/channels`, {
                method: 'GET',
                headers: {
                    Authorization: `Bot ${process.env.TOKEN}`,
                },
            });
            channels = await channels.json();
            if (channels) {
                serverinformation.channels = channels;
            }
            if (serverinformation.channels != null && serverinformation.roles != null) {
                if (serverinformation) {
                    res.status(OK).json(serverinformation);
                } else {
                    res.status(NOT_FOUND);
                }
            }
        }
    }
});
router.post('/serverconfiguration', async (req, res) => {
    const token = req.body.token;
    const id = req.body.id;
    let servers;
    if (userCache[token]) {
        servers = userCache[token].servers;
    } else {
        let discordRes = await fetch('https://discord.com/api/users/@me/guilds', {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
        servers = await discordRes.json();
        userCache[token] = {
            servers: servers,
            date: Date.now(),
        };
    }
    if (servers) {
        let sharedAdminServer = getSharedAdminServers(servers);

        if (sharedAdminServer.find((element) => element.id == id)) {
            let guildConfig = serverConfiguration(id);

            if (guildConfig) {
                res.status(OK).json(guildConfig);
            } else {
                res.status(NOT_FOUND);
            }
        }
    }
});
function getSharedAdminServers(userServer) {
    let botServerIDs = [];
    configData.forEach((server) => botServerIDs.push(server.guildId));
    let userServerIDs = [];
    userServer.forEach((server) => userServerIDs.push(server.id));
    let sharedAdminServer = [];

    userServerIDs.forEach((server) => {
        let found = userServer.find((element) => element.id == server);
        if (found.permissions == '2147483647') {
            if (botServerIDs.includes(server)) {
                sharedAdminServer.push(found);
            }
        }
    });
    return sharedAdminServer;
}
function getSharedAdminServerIDs(sharedAdminServer) {
    let IDs = [];
    sharedAdminServer.forEach((server) => {
        IDs.push(server.id);
    });
    return IDs;
}
function betterSort(userServer) {
    let botServerIDs = [];
    configData.forEach((server) => botServerIDs.push(server.guildId));
    let userServerIDs = [];
    userServer.forEach((server) => userServerIDs.push(server.id));

    let sharedAdminServer = [];
    let sharedServer = [];
    let userOnlyServer = [];
    let sortedServers = [];

    userServerIDs.forEach((server) => {
        let found = userServer.find((element) => element.id == server);
        if (found.permissions == '2147483647') {
            if (botServerIDs.includes(server)) {
                sharedAdminServer.push(found);
            } else {
                userOnlyServer.push(found);
            }
        } else if (botServerIDs.includes(server)) {
            sharedServer.push(found);
        }
    });

    sharedAdminServer.sort();
    sharedAdminServer.reverse();

    sharedServer.sort();
    sharedServer.reverse();

    userOnlyServer.sort();
    userOnlyServer.reverse();

    sortedServers.push(sharedAdminServer);
    sortedServers.push(sharedServer);
    sortedServers.push(userOnlyServer);

    return sortedServers;
}

router.get('/discord', (req, res) => {
    let responseCode = 404;
    let content = '404 Error';
    const urlObj = url.parse(req.url, true);
    if (urlObj.query.code) {
        const accessCode = urlObj.query.code;
        const data = {
            client_id: process.env.CLIENT_ID,
            client_secret: process.env.CLIENT_SECRET,
            grant_type: 'authorization_code',
            redirect_uri: 'https://localhost:3000',
            code: accessCode,
            scope: 'identify guilds',
        };
        fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            body: new URLSearchParams(data),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        })
            .then((discordRes) => discordRes.json())
            .then((info) => {
                return info;
            })
            .then((info) =>
                fetch('https://discord.com/api/users/@me', {
                    headers: {
                        authorization: `${info.token_type} ${info.access_token}`,
                    },
                })
            )
            .then((userRes) => userRes.json());
    }
    if (urlObj.pathname == '/discord') {
        responseCode = 200;
        content = fs.readFileSync('./routes/redirect.html');
    }

    res.writeHead(responseCode, {
        'content-type': 'text/html;charset=utf-8',
    });
    res.write(content.toLocaleString());
    res.end();
});

function isLanguageSupported(language) {
    for (key in languageData.languages) {
        if (key == language) {
            return true;
        }
    }
    return false;
}

module.exports = router;
