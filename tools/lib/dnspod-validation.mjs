import { resolveNs } from 'node:dns/promises';

export async function validationProvider(zone, requested = 'auto', lookup = resolveNs) {
  if (!['auto', 'cloudflare', 'dnspod'].includes(requested)) throw new Error(`未知 DNS 验证提供商：${requested}`);
  if (requested !== 'auto') return requested;
  const servers = (await lookup(zone)).map(ns => ns.toLowerCase().replace(/\.$/, ''));
  if (servers.length && servers.every(ns => ns.endsWith('.cloudflare.com'))) return 'cloudflare';
  if (servers.length && servers.every(ns => /\.(?:dnspod\.(?:net|com|cn)|dnsv\d+\.(?:com|net))$/.test(ns))) return 'dnspod';
  throw new Error(`${zone} 的权威 DNS 无法自动识别：${servers.join(', ')}；请设置 CERT_DNS_PROVIDER`);
}

export function relativeRecordName(zone, name) {
  const base = zone.toLowerCase().replace(/\.$/, '');
  const fqdn = name.toLowerCase().replace(/\.$/, '');
  if (fqdn === base) return '@';
  if (!fqdn.endsWith('.' + base)) throw new Error(`验证记录 ${name} 不属于区域 ${zone}`);
  return fqdn.slice(0, -(base.length + 1));
}

// Only remove record IDs created by this instance. Existing verification records
// may belong to other certificates or callers and must be preserved.
export function createDnsPodValidation(client, remark) {
  const owned = new Map();
  return {
    async check(zone) { await client.DescribeDomain({ Domain: zone }); },
    async add(zone, name, content) {
      const subdomain = relativeRecordName(zone, name);
      const result = await client.CreateRecord({ Domain: zone, SubDomain: subdomain,
        RecordType: 'TXT', RecordLine: '默认', TTL: 600, Value: content, Remark: remark });
      if (!Number.isSafeInteger(result.RecordId) || result.RecordId <= 0) throw new Error('DNSPod 未返回有效记录 ID');
      owned.set(result.RecordId, zone);
      return result.RecordId;
    },
    async remove(zone, recordId) {
      if (owned.get(recordId) !== zone) throw new Error('拒绝删除非本次创建的 DNSPod 验证记录');
      await client.DeleteRecord({ Domain: zone, RecordId: recordId });
      owned.delete(recordId);
    }
  };
}
