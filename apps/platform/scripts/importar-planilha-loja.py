"""
Importa a planilha da loja (abas "Contas a Pagar", "Boletos compartilhados", "Compras Clientes", "Cliente")
para a loja no app. A interpretação das abas é feita no servidor (packages/store/src/import.ts, com testes);
este script só lê o .xlsx e envia as linhas.

Uso:
  pip install openpyxl
  python scripts/importar-planilha-loja.py "Trabalho 2026.xlsx" --email voce@x.com --senha "..." [--codigo 123456]
      [--url http://localhost:5173] [--loja "Larissa — Loja de presentes"]

- --codigo: código do app autenticador, se a conta tiver 2FA.
- --loja: se a conta ainda não tem loja, cria uma com esse nome.
A importação só roda numa loja vazia (sem vendas e sem boletos), para não duplicar.
"""
import argparse
import datetime as dt
import http.cookiejar
import json
import sys
import urllib.error
import urllib.request

import openpyxl


def read_workbook(path: str) -> dict:
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    sheets = {}
    for ws in wb.worksheets:
        rows = []
        for row in ws.iter_rows(values_only=True):
            vals = []
            for v in row[:50]:
                if isinstance(v, (dt.datetime, dt.date)):
                    vals.append(v.strftime('%Y-%m-%d'))
                elif isinstance(v, (int, float)) or v is None:
                    vals.append(v)
                else:
                    vals.append(str(v)[:2000])
            if any(x not in (None, '') for x in vals):
                rows.append(vals)
        sheets[ws.title[:100]] = rows[:5000]
    return {'sheets': sheets}


class Client:
    def __init__(self, base: str):
        self.base = base.rstrip('/')
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def call(self, path: str, body=None, method=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method or ('POST' if data else 'GET'))
        req.add_header('Origin', self.base)
        if data:
            req.add_header('Content-Type', 'application/json')
        try:
            with self.opener.open(req, timeout=60) as res:
                text = res.read().decode()
                return json.loads(text) if text else None
        except urllib.error.HTTPError as e:
            detail = e.read().decode()[:300]
            sys.exit(f'Erro {e.code} em {path}: {detail}')


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser(description='Importa a planilha da loja para o app.')
    ap.add_argument('planilha')
    ap.add_argument('--email', required=True)
    ap.add_argument('--senha', required=True)
    ap.add_argument('--codigo', help='código do app autenticador (se tiver 2FA)')
    ap.add_argument('--url', default='http://localhost:5173')
    ap.add_argument('--loja', help='nome para criar a loja, se ainda não existir')
    args = ap.parse_args()

    wb = read_workbook(args.planilha)
    print('Abas lidas:', ', '.join(f'{k} ({len(v)} linhas)' for k, v in wb['sheets'].items()))

    api = Client(args.url)
    r = api.call('/api/auth/sign-in/email', {'email': args.email, 'password': args.senha})
    if r and r.get('twoFactorRedirect'):
        if not args.codigo:
            sys.exit('Esta conta tem 2FA: rode de novo com --codigo <código do app autenticador>.')
        api.call('/api/auth/two-factor/verify-totp', {'code': args.codigo})
    api.call('/api/me')

    businesses = api.call('/api/store/businesses')
    if not businesses:
        if not args.loja:
            sys.exit('Esta conta ainda não tem loja. Ative no app ou rode com --loja "Nome da loja".')
        api.call('/api/store/businesses', {'name': args.loja})
        businesses = api.call('/api/store/businesses')
    loja = businesses[0]
    print(f"Importando para: {loja['name']}")

    result = api.call(f"/api/store/b/{loja['id']}/import", wb)
    print(f"Importado: {result['customers']} clientes, {result['products']} produtos, {result['sales']} vendas, {result['payables']} boletos.")
    for w in result.get('warnings', []):
        print('  aviso:', w)


if __name__ == '__main__':
    main()
