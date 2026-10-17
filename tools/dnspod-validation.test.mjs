import test from 'node:test';
import assert from 'node:assert/strict';
import { validationProvider, relativeRecordName, createDnsPodValidation } from './lib/dnspod-validation.mjs';

test('selects the current authoritative provider and refuses unknown DNS', async () => {
  assert.equal(await validationProvider('example.com', 'auto', async () => ['etta.ns.cloudflare.com.', 'elias.ns.cloudflare.com']), 'cloudflare');
  assert.equal(await validationProvider('example.com', 'auto', async () => ['f1g1ns1.dnspod.net', 'f1g1ns2.dnspod.net']), 'dnspod');
  assert.equal(await validationProvider('example.com', 'auto', async () => ['a.dnsv2.com', 'b.dnsv2.com']), 'dnspod');
  await assert.rejects(validationProvider('example.com', 'auto', async () => ['ns.other.com']), /无法自动识别/);
  await assert.rejects(validationProvider('example.com', 'auto', async () => []), /无法自动识别/);
  await assert.rejects(validationProvider('example.com', 'typo'), /未知/);
});

test('validation names cannot escape the selected zone', () => {
  assert.equal(relativeRecordName('example.com', '_dnsauth.blog.EXAMPLE.com.'), '_dnsauth.blog');
  assert.equal(relativeRecordName('example.com', 'example.com'), '@');
  assert.throws(() => relativeRecordName('example.com', '_dnsauth.notexample.com'), /不属于/);
});

test('only deletes TXT records created by this invocation; failed cleanup can retry', async () => {
  const calls = [];
  let fail = true;
  const adapter = createDnsPodValidation({
    DescribeDomain: async args => { calls.push(['check', args]); },
    CreateRecord: async args => { calls.push(['create', args]); return { RecordId: 42 }; },
    DeleteRecord: async args => { calls.push(['delete', args]); if (fail) throw new Error('network'); }
  }, 'managed validation');
  await adapter.check('example.com');
  await assert.rejects(adapter.remove('example.com', 99), /拒绝/);
  await assert.rejects(adapter.add('example.com', 'foreign.com', 'value'), /不属于/);
  assert.equal(await adapter.add('example.com', '_dnsauth.blog.example.com', 'value'), 42);
  assert.deepEqual(calls[1][1], { Domain: 'example.com', SubDomain: '_dnsauth.blog', RecordType: 'TXT', RecordLine: '默认', TTL: 600, Value: 'value', Remark: 'managed validation' });
  await assert.rejects(adapter.remove('other.com', 42), /拒绝/);
  await assert.rejects(adapter.remove('example.com', 42), /network/);
  fail = false;
  await adapter.remove('example.com', 42);
  await assert.rejects(adapter.remove('example.com', 42), /拒绝/);
});
