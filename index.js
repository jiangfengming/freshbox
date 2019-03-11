const CachePolicy = require('http-cache-semantics')
const zlib = require('zlib')
const { createClient } = require('redis')
const ReadStream = require('redis-rstream')
const WriteStream = require('redis-wstream')
const { promisify } = require('util')

class Freshbox {
  constructor({ redis }) {
    this.redis = createClient(redis, { detect_buffers: true })
    this.redis.getAsync = promisify(this.redis.get)
    this.redis.setAsync = promisify(this.redis.set)
  }

  async get(req) {
    let vary = await this.redis.getAsync(req.url + ':vary')
    if (vary === null) return null

    const cacheKey = Freshbox._getCacheKey(req, vary)

    let meta = await this.redis.getAsync(cacheKey + ':meta')
    if (!meta) return null
    meta = JSON.parse(meta)

    const policy = CachePolicy.fromObject(meta.policy)
    if (policy.satisfiesWithoutRevalidation({ headers: req.headers })) {
      const headers = policy.responseHeaders()

      let body = new ReadStream(this.redis, Buffer.from(cacheKey + ':' + meta.version))
      if (headers['content-encoding'] === 'gzip'
        && (!req.headers['accept-encoding'] || !req.headers['accept-encoding'].includes('gzip'))
      ) {
        delete headers['content-encoding']
        body = body.pipe(zlib.createGunzip())
      }

      return {
        needRevalidate: false,
        response: {
          headers,
          body
        }
      }
    } else {
      const headers = policy.revalidationHeaders({ headers: req.headers })
      return {
        needRevalidate: true,
        policy,
        request: {
          url: req.url,
          headers
        }
      }
    }
  }

  set(req, res, policy) {
    const cacheKey = Freshbox._getCacheKey(req, res.headers.vary)

    if (policy) {
      policy.revalidatedPolicy()
    }
  }

  static _getCacheKey(req, vary) {
    let cacheKey = req.url

    if (vary) {
      vary = vary.toLowerCase().split(/,\s*/)
      for (const v of vary) {
        if (v === 'accept-encoding') continue
        cacheKey += ':' + v + ':' + (req.headers[v] || '')
      }
    }

    return cacheKey
  }
}

module.exports = Freshbox
