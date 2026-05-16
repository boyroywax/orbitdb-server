import { generateSwarmKey, saveSwarmKey } from '../network/pnet.js'

const key = generateSwarmKey()
const outputPath = process.argv[2]

if (outputPath) {
  saveSwarmKey(key, outputPath)
  console.log(`Swarm key written to: ${outputPath}`)
} else {
  console.log(key)
}
