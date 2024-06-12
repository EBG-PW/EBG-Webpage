/**
 * Generate a unique url path for one time tokens
 * @param {Number} length 
 */
const generateUrlPath = (length = 256) => {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

const bigIntReplacer = (key, value) => {
  return typeof value === 'bigint' ? value.toString() : value;
}

module.exports = {
    generateUrlPath: generateUrlPath,
    bigIntReplacer: bigIntReplacer
}