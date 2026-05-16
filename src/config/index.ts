import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { ConfigSchema, type Config } from '../types/index.js'

const CONFIG_PATH = process.env.CONFIG_PATH || resolve(process.cwd(), 'config/config.json')

export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`Config file not found: ${CONFIG_PATH}`)
  }

  const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
  return ConfigSchema.parse(raw)
}
