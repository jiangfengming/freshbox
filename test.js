const Policy = require('http-cache-semantics')

const policy = new Policy(
  { headers: { } },
  { headers: { 'cache-control': 'max-age=100', 'content-length': '606', 'content-encoding': 'gzip', etag: 'asddfgh' } }
)

console.log(policy.satisfiesWithoutRevalidation({ headers: { 'if-none-match': 'asdfgh' } }))
console.log(policy.responseHeaders())
const reqHeaders = policy.revalidationHeaders({ headers: { } })
console.log(reqHeaders)
console.log(policy.revalidatedPolicy({ headers: reqHeaders }, { status: 200, headers: { etag: 'asdfgh', 'cache-control': 'max-age=100' } }).modified)
