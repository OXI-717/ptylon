import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/admin-auth', () => ({ verifyAdminRequest: vi.fn(() => null) }));
vi.mock('@/lib/admin-gateway-request', () => ({ sendGatewayRequest: vi.fn() }));
vi.mock('@/lib/admin-gateway', () => ({ sendGatewayMessage: vi.fn() }));
import { verifyAdminRequest } from '@/lib/admin-auth';
import { sendGatewayRequest } from '@/lib/admin-gateway-request';
import { GET } from './route';
const req = () => new NextRequest('http://localhost/api/admin/exec');
beforeEach(() => vi.resetAllMocks());
it('returns only IDs from a complete correlated session list', async () => {
  vi.mocked(sendGatewayRequest).mockResolvedValue({ data: [{id:'live-id',name:'private'}] });
  expect(await (await GET(req())).json()).toEqual({complete:true,session_ids:['live-id']});
  expect(sendGatewayRequest).toHaveBeenCalledWith({type:'list'}, 'sessions');
});
it('accepts a confirmed empty daemon list', async () => {
  vi.mocked(sendGatewayRequest).mockResolvedValue({data:[]});
  expect(await (await GET(req())).json()).toEqual({complete:true,session_ids:[]});
});
it.each([{}, {data:null}, {data:[{}]}, {data:[{id:''}]}])('rejects malformed response %j', async response => {
  vi.mocked(sendGatewayRequest).mockResolvedValue(response);
  expect((await GET(req())).status).toBe(503);
});
it('timeout cannot mean no live sessions', async () => {
  vi.mocked(sendGatewayRequest).mockRejectedValue(new Error('timeout'));
  const response = await GET(req());
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({complete:false});
});
it('requires admin auth before querying daemon', async () => {
  vi.mocked(verifyAdminRequest).mockReturnValue(NextResponse.json({}, {status:401}));
  expect((await GET(req())).status).toBe(401);
  expect(sendGatewayRequest).not.toHaveBeenCalled();
});
