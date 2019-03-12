const CachePolicy = require('http-cache-semantics')
const zlib = require('zlib')
const compressible = require('compressible')
const Redis = require('ioredis')
const ReadStream = require('redis-rstream')
const WriteStream = require('redis-wstream')

class Freshbox {
  constructor({ redis, maxmemory }) {
    this.redis = new Redis(redis)
    this.redis.config('set', 'maxmemory', maxmemory)
    this.redis.config('set', 'maxmemory-policy', 'allkeys-lru')
  }

  get(req) {
    return new Cache(this.redis, req)
  }
}

class Cache {
  constructor(redis, { url, headers }) {
    this.redis = redis
    this.url = url
    this.requestHeaders = { ...headers }
  }

  async status() {
    if (this._status) return this._status

    this._status = 'MISS'
    this.vary = await this.redis.get(this.url + ':vary')
    if (!this.vary) return this._status

    this.cacheKey = this._getCacheKey(this.vary)

    const meta = await this.redis.get(this.cacheKey + ':meta')
    if (!meta) return this._status

    this.meta = JSON.parse(meta)

    if (!await this.redis.exists(this.cacheKey + ':' + this.meta.version)) {
      return this._status
    }

    this.policy = CachePolicy.fromObject(this.meta.policy)
    this.responseHeaders = this.policy.responseHeaders()

    this._status = this.policy.satisfiesWithoutRevalidation({ headers: this.requestHeaders }) ? 'HIT' : 'EXPIRED'
    return this._status
  }

  async response() {
    if (!await this.status() === 'MISS') {
      return null
    }

    this.body = new ReadStream(this.redis, Buffer.from(this.cacheKey + ':' + this.meta.version))
    if (this.responseHeaders['content-encoding'] === 'gzip'
      && (!this.requestHeaders['accept-encoding'] || !this.requestHeaders['accept-encoding'].includes('gzip'))
    ) {
      delete this.responseHeaders['content-encoding']
      this.body = this.body.pipe(zlib.createGunzip())
    }

    return {
      headers: this.responseHeaders,
      body: this.body
    }
  }

  async save({ headers, body }) {
    headers = { ...headers }

    if (headers.vary) {
      headers.vary = headers.vary.split(/,\s*/).filter(v => v.toLowerCase() !== 'accept-encoding').join(',')
    }

    const cacheKey = this._getCacheKey(headers.vary)


  }

  _getCacheKey(vary) {
    let cacheKey = this.url

    if (vary) {
      vary = vary.toLowerCase().split(/,\s*/)
      for (const v of vary) {
        cacheKey += ':' + v + ':' + (this.requestHeaders[v] || '')
      }
    }

    return cacheKey
  }
}

module.exports = Freshbox
