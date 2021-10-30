const functions = require('firebase-functions');
const express = require('express');
const {Storage} = require('@google-cloud/storage');
const app = express();
const path = require('path');
const os = require('os');
const admin = require('firebase-admin');
const mkdirp = require('mkdirp');
const spawn = require('child-process-promise').spawn;
const fs = require('fs');

admin.initializeApp();

const storage = new Storage({
    projectId: 'ppi-infotainment'
});

const systems = [
    {systemId: 'infotainment-pi-1',
    description: 'Raspberry PI 5. Stock Hackathon 2021/10'},
    {systemId: 'bendts-alter-laptop',
    description: '5. OG Flur'}
];

const bucket = storage.bucket('ppi-infotainment.appspot.com');

app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*"); // update to match the domain you will make the request from
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    res.header("Allow", "OPTIONS, GET, HEAD, DELETE, POST, PUT, PATCH");
    res.header("Access-Control-Allow-Methods", "OPTIONS, GET, HEAD, DELETE, POST, PUT, PATCH");
    next();
});

app.get('/editorial', (req, res) => {
        res.json(systems);
});

app.get('/editorial/:systemId/description', async (req, res) => {
    for (let system of systems) {
        if (system.systemId === req.params.systemId) {
            res.json(system);
        }
    }
});

app.get('/editorial/:systemId', async (req, res) => {
        let [files] = await bucket.getFiles({prefix: req.params.systemId + '/'});
        const metadatas = [];
        const regstr = '^' + req.params.systemId + '/$';
        const regex = new RegExp(regstr, 'gi');
        files = files.filter(file => !file.name.match(regex));
        console.log(files);
        for (const file of files) {
            const [metadata] = await file.getMetadata();
            metadatas.push({
                filename: file.name.replace(req.params.systemId + '/', ''),
                filetype: metadata.contentType
            });
        }
        res.json(metadatas);
});

app.get('/editorial/:systemId/full', async (req, res) => {
    let [files] = await bucket.getFiles({prefix: req.params.systemId + '/'});
    const metadatas = [];
    const regstr = '^' + req.params.systemId + '/$';
    const regex = new RegExp(regstr, 'gi');
    files = files.filter(file => !file.name.match(regex));
    console.log(files);
    for (const file of files) {
        const [metadata] = await file.getMetadata();
        if (metadata.contentType.match(/^image\/.*$/gi) || metadata.contentType.match(/^application\/pdf$/gi)) {
            metadatas.push({
                filename: file.name.replace(req.params.systemId + '/', ''),
                filetype: metadata.contentType,
                content: 'https://storage.googleapis.com/ppi-infotainment.appspot.com/' + file.name
            });
        } else {
            metadatas.push({
                filename: file.name.replace(req.params.systemId + '/', ''),
                filetype: metadata.contentType,
                content: (await file.download()).toString('utf-8')
            });
        }
    }
    res.json(metadatas);
});

app.get('/contents', async (req, res) => {
        let [files] = await bucket.getFiles();
        const metadatas = [];
        files = files.filter(file => !file.name.match(/^.*\/$/gi));
        console.log(files);
        for (const file of files) {
            const [metadata] = await file.getMetadata();
            metadatas.push({
                filename: file.name,
                filetype: metadata.contentType
            });
        }
        res.json(metadatas);
});

app.post('/editorial/:systemId', async (req, res) => {
        const fullName = req.params.systemId + '/' + req.body.filename;
        if (req.body.filetype.match(/^image\/.*$/gi)) {
            console.log(fullName);
            await imageConvert(fullName, req.body.filetype, Buffer.from(req.body.content, 'base64'));
            res.sendStatus(200);
        } else if (req.body.filetype.match(/^application\/vnd\.infotainment\.externalvideo$/gi)
            || req.body.filetype.match(/^application\/vnd\.infotainment\.url$/gi)) {
            const file = bucket.file(fullName);
            await file.save(req.body.content, {
                contentType: req.body.filetype
            });
            res.sendStatus(200);
        } else if (req.body.filetype.match(/^application\/pdf$/gi)) {
            const file = bucket.file(fullName);
            await file.save(Buffer.from(req.body.content, 'base64'), {
                contentType: req.body.filetype
            });
            res.sendStatus(200);
        } else {
            res.sendStatus(422);
        }
});

app.get('/editorial/:systemId/:filename', async (req, res) => {
        const fullName = req.params.systemId + '/' + req.params.filename;
        const file = await bucket.file(fullName);
        const [metadata] = await file.getMetadata();
        if (metadata.contentType.match(/^image\/.*$/gi) || metadata.contentType.match(/^application\/pdf$/gi)) {
            res.json({
                filename: req.params.filename,
                filetype: metadata.contentType,
                content: 'https://storage.googleapis.com/ppi-infotainment.appspot.com/' + fullName
            });
        } else {
            res.json({
                filename: req.params.filename,
                filetype: metadata.contentType,
                content: (await file.download()).toString('utf-8')
            });
        }
});

app.delete('/editorial/:systemId', async (req, res) => {
        let [files] = await bucket.getFiles({prefix: req.params.systemId + '/'});
        const regstr = '^' + req.params.systemId + '/$';
        const regex = new RegExp(regstr, 'gi');
        files = files.filter(file => !file.name.match(regex));
        for (let file of files) {
            await file.delete();
        }
        res.sendStatus(200);
});

app.delete('/editorial/:systemId/:filename', async (req, res) => {
       const file = await bucket.file(req.params.systemId + '/' + req.params.filename);
       await file.delete();
       res.sendStatus(200);
});

app.patch('/editorial/:systemId/:filename', async (req, res) => {
    let fullName = req.body.filename;
    if (fullName == null) {
        fullName = req.params.filename;
    }
    let contentType = req.body.filetype;
    if (contentType == null) {
        const file = bucket.file(req.params.filename);
        const [metadata] = await file.getMetadata();
        contentType = metadata.contentType;
    }
    let content = req.body.content;
    if (content == null) {
        const file = bucket.file(req.params.filename);
        content = [await file.download()];
    }
    if (contentType.match(/^image\/.*$/gi)) {
        console.log(fullName);
        const file = bucket.file(req.params.filename);
        await file.delete();
        await imageConvert(fullName, contentType, Buffer.from(content, 'base64'));
        res.sendStatus(200);
    } else if (contentType.match(/^application\/vnd\.infotainment\.externalvideo$/gi)
        || contentType.match(/^application\/vnd\.infotainment\.url$/gi)) {
        const fileForDelete = bucket.file(req.params.filename);
        const file = bucket.file(fullName);
        await fileForDelete.delete();
        await file.save(content, {
            contentType: contentType
        });
        res.sendStatus(200);
    } else if (contentType.match(/^application\/pdf$/gi)) {
        const fileForDelete = bucket.file(req.params.filename);
        const file = bucket.file(fullName);
        await fileForDelete.delete();
        await file.save(Buffer.from(content, 'base64'), {
            contentType: contentType
        });
        res.sendStatus(200);
    } else {
        res.sendStatus(422);
    }
});

async function imageConvert (filePath, contentType, buffer) {
    const baseFileName = path.basename(filePath, path.extname(filePath));
    const fileDir = path.dirname(filePath);
    const PNGFilePath = path.normalize(path.format({dir: fileDir, name: baseFileName, ext: '.png'}));
    const tempLocalFile = path.join(os.tmpdir(), filePath);
    const tempLocalDir = path.dirname(tempLocalFile);
    const tempLocalPNGFile = path.join(os.tmpdir(), PNGFilePath);

    // Create the temp directory where the storage file will be downloaded.
    await mkdirp(tempLocalDir);
    fs.writeFile(tempLocalFile, buffer, function (err) {
        if (err) throw err;
        console.log('Saved!');
    });

    // Exit if this is triggered on a file that is not an image.
    if (!contentType.startsWith('image/')) {
        console.log('This is not an image.');
        return null;
    }

    // Exit if the image is already a JPEG.
    if (contentType.startsWith('image/png')) {
        console.log('Already a PNG.');
        await bucket.upload(tempLocalFile, {destination: PNGFilePath, contentType: 'image/png'});
        return null;
    }

    // Convert the image to JPEG using ImageMagick.
    await spawn('convert', [tempLocalFile, tempLocalPNGFile]);
    console.log('PNG image created at', tempLocalPNGFile);
    // Uploading the PNG image.
    await bucket.upload(tempLocalPNGFile, {destination: PNGFilePath, contentType: 'image/png'});
    console.log('PNG image uploaded to Storage at', PNGFilePath);
    // Once the image has been converted delete the local files to free up disk space.
    fs.unlinkSync(tempLocalPNGFile);
    fs.unlinkSync(tempLocalFile);
    return null;
}

exports.v1 = functions.https.onRequest(app);

