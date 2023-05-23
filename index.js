const https = require('https');
const redis = require('redis');

const { API_KEY, STORE_HOST, STORE_PORT } = process.env;

const get = (url) => new Promise((resolve, reject) => {
    const req = https.request(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
        res.on('error', reject);
    });

    req.on('error', reject);
    req.end();
});

get(`https://api.nytimes.com/svc/topstories/v2/home.json?api-key=${API_KEY}`).then(data => {
    return data.results.map(({ title, abstract, multimedia }) => {
        const captions = (multimedia || []).reduce((acc, { caption }) => acc.add(caption), new Set());
        return [title, abstract, ...captions];
    }).filter(blurbs => !!blurbs).reduce((acc, blurbs) => [...acc, ...blurbs], []);
}).then(blurbs => {
    // return blurbs.map(blurb => blurb.replaceAll(/(\.|!|\?)(\s|$)/g, '$1\n').split('\n').filter(phrase => !!phrase))
    return blurbs.map(blurb => blurb.replaceAll(/(\.|!|\?)(\s(\S*[A-Z0-9])|$)/g, '$1\n$3').split('\n').filter(phrase => !!phrase))
        .reduce((acc, phrases) => [...acc, ...phrases], []);
}).then(phrases => {
    return phrases.map(phrase => [...phrase.matchAll(/(\w+(\S*\w)*)(\.|!|\?|:|;|,)?/g)].map(match => match[0])).map(words => {
        return words.map(word => {
            return {
                value: word,
                key: /(\w+(\S*\w)*)/.test(word) ? /(\w+(\S*\w)*)/.exec(word)[0].toLowerCase() : word
            }
        });
    });
}).then(phrasesInWords => {
    const client = redis.createClient({ host: STORE_HOST, port: STORE_PORT });
    const batch = Date.now();
    client.lpush('batches:training', ...phrasesInWords.map(phrase => JSON.stringify({ batch, phrase })), () => {
        client.end(true);
    });
});
