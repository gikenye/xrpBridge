import { createServer } from 'http';
import { parse } from 'url';
import swapHandler from './api/swap';
import quoteHandler from './api/quote';
import verifyDepositHandler from './api/verify-deposit';
import trackDepositHandler from './api/track-deposit';
import recentDepositsHandler from './api/recent-deposits';
import offrampHandler from './api/offramp';
import bridgeHandler from './api/bridge';
import userBalanceHandler from './api/user-balance';
import userDepositsHandler from './api/user-deposits';

const PORT = process.env.PORT || 3000;

const server = createServer(async (req, res) => {
  const { pathname } = parse(req.url || '', true);

  // Mock Vercel request/response objects
  const vercelReq = {
    ...req,
    body: await getBody(req),
    query: parse(req.url || '', true).query,
    headers: req.headers
  } as any;

  const vercelRes = {
    status: (code: number) => ({ 
      json: (data: any) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      },
      end: () => {
        res.writeHead(code);
        res.end();
      }
    }),
    setHeader: (name: string, value: string) => res.setHeader(name, value)
  } as any;

  try {
    switch (pathname) {
      case '/api/swap':
        await swapHandler(vercelReq, vercelRes);
        break;
      case '/api/quote':
        await quoteHandler(vercelReq, vercelRes);
        break;
      case '/api/bridge':
        await bridgeHandler(vercelReq, vercelRes);
        break;
      case '/api/verify-deposit':
        await verifyDepositHandler(vercelReq, vercelRes);
        break;
      case '/api/track-deposit':
        await trackDepositHandler(vercelReq, vercelRes);
        break;
      case '/api/recent-deposits':
        await recentDepositsHandler(vercelReq, vercelRes);
        break;
        case '/api/offramp':
        await offrampHandler(vercelReq, vercelRes);
        break;
        case '/api/user-balance':
        await userBalanceHandler(vercelReq, vercelRes);
        break;
        case '/api/user-deposits':
        await userDepositsHandler(vercelReq, vercelRes);
        break;
      default:
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    }
  } catch (error) {
    console.error('Dev server error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    }));
  }
});

async function getBody(req: any): Promise<any> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: any) => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

server.listen(PORT, () => {
  console.log(`🚀 Dev server running on http://localhost:${PORT}`);
  console.log(`📋 Available endpoints:`);
  console.log(`  POST http://localhost:${PORT}/api/swap`);
  console.log(`  POST http://localhost:${PORT}/api/quote`);
  console.log(`  POST http://localhost:${PORT}/api/bridge`);
  console.log(`  POST http://localhost:${PORT}/api/verify-deposit`);
  console.log(`  POST http://localhost:${PORT}/api/track-deposit`);
  console.log(`  GET  http://localhost:${PORT}/api/recent-deposits`);
});