const { createEnvelope, parseEnvelope } = require('persistence-drizzle')
const { createNodeSqliteDriver } = require('persistence-drizzle/node')

const target = { app: 'com.example.game', kind: 'profile', currentVersion: 1 }
const text = createEnvelope(target, 1, { name: 'Player One' }, Date.now())
console.log(parseEnvelope(text, target))

const driver = createNodeSqliteDriver()
driver
  .query('select 1 as one', [])
  .then((rows) => {
    console.log(rows)
    return driver.close()
  })
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
