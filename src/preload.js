const { readFileSync, writeFileSync } = require('fs')

window.readFile = function (file) {
    return  readFileSync(file, 'utf8')
}
   

window.writeFile = function (filePath, data) {
    try {
        writeFileSync(filePath, data)
        return ''
    } catch (err) {
        return err
    }
}	
