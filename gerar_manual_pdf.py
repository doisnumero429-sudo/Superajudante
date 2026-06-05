#!/usr/bin/env python3
# gerar_manual_pdf.py — Gera o manual do Super Ajudante em PDF

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm, mm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable, KeepTogether
)
from reportlab.graphics.shapes import (
    Drawing, Rect, String, Line, Circle, Polygon, Path, Group
)
from reportlab.graphics import renderPDF


def RoundRect(x, y, w, h, r, fillColor=None, strokeColor=None, strokeWidth=1):
    r = min(r, w / 2, h / 2)
    p = Path(fillColor=fillColor, strokeColor=strokeColor, strokeWidth=strokeWidth)
    p.moveTo(x + r, y)
    p.lineTo(x + w - r, y)
    p.curveTo(x + w, y, x + w, y, x + w, y + r)
    p.lineTo(x + w, y + h - r)
    p.curveTo(x + w, y + h, x + w, y + h, x + w - r, y + h)
    p.lineTo(x + r, y + h)
    p.curveTo(x, y + h, x, y + h, x, y + h - r)
    p.lineTo(x, y + r)
    p.curveTo(x, y, x, y, x + r, y)
    p.closePath()
    return p
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import os

# ─── Cores ───────────────────────────────────────────────────────────────────
VERDE      = colors.HexColor('#2E7D32')
VERDE_CLARO= colors.HexColor('#E8F5E9')
VERDE_MED  = colors.HexColor('#4CAF50')
AZUL       = colors.HexColor('#1565C0')
AZUL_CLARO = colors.HexColor('#E3F2FD')
AZUL_MED   = colors.HexColor('#1976D2')
LARANJA    = colors.HexColor('#E65100')
LARANJA_CL = colors.HexColor('#FFF3E0')
VERMELHO   = colors.HexColor('#C62828')
VERM_CLARO = colors.HexColor('#FFEBEE')
CINZA_ESC  = colors.HexColor('#212121')
CINZA_MED  = colors.HexColor('#757575')
CINZA_CLARO= colors.HexColor('#F5F5F5')
CINZA_BORD = colors.HexColor('#E0E0E0')
BRANCO     = colors.white
PRETO      = colors.black
AMARELO_CL = colors.HexColor('#FFFDE7')
AMARELO    = colors.HexColor('#F9A825')

W, H = A4  # 595 x 842 pt

# ─── Estilos ─────────────────────────────────────────────────────────────────
styles = getSampleStyleSheet()

def S(name, **kw):
    base = styles.get(name) or styles['Normal']
    return ParagraphStyle(name + str(id(kw)), parent=base, **kw)

titulo_capa = S('Normal', fontSize=32, fontName='Helvetica-Bold',
                textColor=BRANCO, alignment=TA_CENTER, leading=40)
subtitulo_capa = S('Normal', fontSize=16, fontName='Helvetica',
                   textColor=colors.HexColor('#C8E6C9'), alignment=TA_CENTER, leading=22)
cap_titulo = S('Normal', fontSize=20, fontName='Helvetica-Bold',
               textColor=VERDE, spaceBefore=20, spaceAfter=8)
sec_titulo = S('Normal', fontSize=14, fontName='Helvetica-Bold',
               textColor=CINZA_ESC, spaceBefore=14, spaceAfter=6)
corpo = S('Normal', fontSize=11, fontName='Helvetica',
          textColor=CINZA_ESC, leading=17, spaceAfter=6, alignment=TA_JUSTIFY)
corpo_bold = S('Normal', fontSize=11, fontName='Helvetica-Bold',
               textColor=CINZA_ESC, leading=17, spaceAfter=4)
nota_tip = S('Normal', fontSize=10, fontName='Helvetica',
             textColor=colors.HexColor('#1565C0'), leading=15, spaceAfter=4)
label_small = S('Normal', fontSize=9, fontName='Helvetica',
                textColor=CINZA_MED, leading=13)
bullet = S('Normal', fontSize=11, fontName='Helvetica',
           textColor=CINZA_ESC, leading=17, leftIndent=16,
           bulletIndent=6, spaceAfter=3)

# ─── Helpers de mockup ───────────────────────────────────────────────────────

def phone_frame(content_drawing, title='Super Ajudante', width=220, height=380):
    """Desenha um frame de celular com conteúdo interno."""
    d = Drawing(width + 40, height + 80)
    # Sombra
    d.add(RoundRect(23, 3, width + 4, height + 56, 20,
                    fillColor=colors.HexColor('#BDBDBD'), strokeColor=None))
    # Corpo do celular
    d.add(RoundRect(20, 6, width + 4, height + 56, 20,
                    fillColor=CINZA_ESC, strokeColor=None))
    # Tela
    d.add(Rect(26, 12, width - 8, height + 44,
               fillColor=BRANCO, strokeColor=None))
    # Barra de status
    d.add(Rect(26, height + 44, width - 8, 12,
               fillColor=colors.HexColor('#1B5E20'), strokeColor=None))
    d.add(String(30, height + 47, '9:41', fontSize=7,
                 fontName='Helvetica-Bold', fillColor=BRANCO))
    d.add(String(width - 28, height + 47, '●●●', fontSize=7,
                 fontName='Helvetica', fillColor=BRANCO))
    # Barra de navegação (topo do app)
    d.add(Rect(26, height + 26, width - 8, 18,
               fillColor=VERDE, strokeColor=None))
    d.add(String(34, height + 31, title, fontSize=9,
                 fontName='Helvetica-Bold', fillColor=BRANCO))
    # Botão home
    d.add(Circle(22 + width / 2, 9, 5,
                 fillColor=colors.HexColor('#424242'), strokeColor=None))
    # Adiciona o conteúdo
    content_drawing.transform = (1, 0, 0, 1, 26, 12)
    d.add(content_drawing)
    return d


def tela_entrada():
    """Tela de entrada de NF-e."""
    d = Drawing(212, 370)
    # Fundo
    d.add(Rect(0, 0, 212, 370, fillColor=CINZA_CLARO, strokeColor=None))
    # Card principal
    d.add(RoundRect(8, 270, 196, 90, 8,
                    fillColor=BRANCO, strokeColor=CINZA_BORD, strokeWidth=0.5))
    d.add(String(16, 348, 'Chave da NF-e (44 dígitos)', fontSize=8,
                 fontName='Helvetica-Bold', fillColor=CINZA_MED))
    d.add(RoundRect(12, 316, 188, 26, 4,
                    fillColor=BRANCO, strokeColor=VERDE, strokeWidth=1.5))
    d.add(String(18, 325, '35250312345678000195550010000', fontSize=7,
                 fontName='Helvetica', fillColor=CINZA_ESC))
    # Botão câmera
    d.add(RoundRect(12, 285, 90, 22, 4,
                    fillColor=AZUL_CLARO, strokeColor=AZUL_MED, strokeWidth=1))
    d.add(String(24, 292, '📷  Escanear QR', fontSize=7,
                 fontName='Helvetica', fillColor=AZUL))
    # Botão upload
    d.add(RoundRect(108, 285, 90, 22, 4,
                    fillColor=VERDE_CLARO, strokeColor=VERDE, strokeWidth=1))
    d.add(String(120, 292, '📎  Arquivo XML', fontSize=7,
                 fontName='Helvetica', fillColor=VERDE))
    # Botão confirmar
    d.add(RoundRect(8, 242, 196, 24, 6,
                    fillColor=VERDE, strokeColor=None))
    d.add(String(68, 250, 'BUSCAR NOTA', fontSize=9,
                 fontName='Helvetica-Bold', fillColor=BRANCO))
    # Aguardando...
    d.add(RoundRect(8, 195, 196, 38, 6,
                    fillColor=AMARELO_CL, strokeColor=AMARELO, strokeWidth=1))
    d.add(String(14, 223, '⏳  Buscando nota na Meu Danfe...', fontSize=8,
                 fontName='Helvetica', fillColor=colors.HexColor('#6D4C41')))
    d.add(String(14, 210, 'Aguarde alguns segundos', fontSize=7.5,
                 fontName='Helvetica', fillColor=CINZA_MED))
    # Histórico recente
    d.add(String(12, 188, 'Notas importadas recentemente', fontSize=8,
                 fontName='Helvetica-Bold', fillColor=CINZA_MED))
    for i, (num, forn, data) in enumerate([
        ('001.234', 'Dist. Alimentos SA', '03/06/25'),
        ('000.891', 'Bebidas Central Ltda', '01/06/25'),
    ]):
        y = 170 - i * 30
        d.add(RoundRect(8, y, 196, 24, 4,
                        fillColor=BRANCO, strokeColor=CINZA_BORD, strokeWidth=0.5))
        d.add(Circle(22, y + 12, 8, fillColor=VERDE_CLARO, strokeColor=None))
        d.add(String(18, y + 9, '✓', fontSize=8, fontName='Helvetica-Bold', fillColor=VERDE))
        d.add(String(34, y + 14, f'NF {num} — {forn}', fontSize=7.5,
                     fontName='Helvetica-Bold', fillColor=CINZA_ESC))
        d.add(String(34, y + 4, data, fontSize=7, fontName='Helvetica', fillColor=CINZA_MED))
    return d


def tela_conferencia():
    """Tela de conferência de produtos."""
    d = Drawing(212, 370)
    d.add(Rect(0, 0, 212, 370, fillColor=CINZA_CLARO, strokeColor=None))
    # Cabeçalho da nota
    d.add(RoundRect(6, 336, 200, 30, 4,
                    fillColor=AZUL_CLARO, strokeColor=AZUL_MED, strokeWidth=0.5))
    d.add(String(14, 356, 'NF 001.234 — Dist. Alimentos SA', fontSize=8,
                 fontName='Helvetica-Bold', fillColor=AZUL))
    d.add(String(14, 344, '15 itens   |   R$ 2.847,50   |   03/06/2025', fontSize=7.5,
                 fontName='Helvetica', fillColor=CINZA_MED))
    # Produto reconhecido (verde)
    d.add(RoundRect(6, 296, 200, 36, 4,
                    fillColor=VERDE_CLARO, strokeColor=VERDE_MED, strokeWidth=1))
    d.add(String(12, 323, '✓  Arroz Agulhinha 5kg', fontSize=8,
                 fontName='Helvetica-Bold', fillColor=VERDE))
    d.add(String(12, 312, '10 SC  →  50 KG estoque  |  R$ 4,80/kg', fontSize=7.5,
                 fontName='Helvetica', fillColor=CINZA_MED))
    d.add(String(12, 300, 'Reconhecido: CNPJ + código', fontSize=7,
                 fontName='Helvetica', fillColor=VERDE))
    # Produto NOVO (destaque laranja)
    d.add(RoundRect(6, 240, 200, 52, 4,
                    fillColor=LARANJA_CL, strokeColor=LARANJA, strokeWidth=1.5))
    d.add(String(12, 282, '⚠  PRODUTO NOVO — preencha os dados', fontSize=7.5,
                 fontName='Helvetica-Bold', fillColor=LARANJA))
    d.add(String(12, 270, 'CERVEJA HEINEKEN 600ML CX24', fontSize=8,
                 fontName='Helvetica', fillColor=CINZA_ESC))
    # Campo nome
    d.add(String(12, 257, 'Nome interno:', fontSize=7,
                 fontName='Helvetica-Bold', fillColor=CINZA_MED))
    d.add(RoundRect(12, 243, 190, 13, 3,
                    fillColor=BRANCO, strokeColor=LARANJA, strokeWidth=1))
    d.add(String(16, 247, 'Cerveja Heineken 600ml Long Neck', fontSize=7,
                 fontName='Helvetica', fillColor=CINZA_ESC))
    # Produto reconhecido 2
    d.add(RoundRect(6, 200, 200, 36, 4,
                    fillColor=VERDE_CLARO, strokeColor=VERDE_MED, strokeWidth=1))
    d.add(String(12, 226, '✓  Azeite Extra Virgem 500ml', fontSize=8,
                 fontName='Helvetica-Bold', fillColor=VERDE))
    d.add(String(12, 215, '24 UN  →  24 UN estoque  |  R$ 18,50/UN', fontSize=7.5,
                 fontName='Helvetica', fillColor=CINZA_MED))
    d.add(String(12, 203, 'Reconhecido: mapeamento anterior', fontSize=7,
                 fontName='Helvetica', fillColor=VERDE))
    # Barra inferior
    d.add(RoundRect(6, 158, 200, 36, 4,
                    fillColor=AMARELO_CL, strokeColor=AMARELO, strokeWidth=1))
    d.add(String(12, 183, '⚠  1 produto precisa de categoria', fontSize=8,
                 fontName='Helvetica-Bold', fillColor=colors.HexColor('#6D4C41')))
    d.add(String(12, 171, 'Preencha antes de confirmar', fontSize=7.5,
                 fontName='Helvetica', fillColor=CINZA_MED))
    # Botão confirmar
    d.add(RoundRect(6, 130, 200, 24, 6, fillColor=VERDE, strokeColor=None))
    d.add(String(52, 138, 'CONFIRMAR E GRAVAR', fontSize=8.5,
                 fontName='Helvetica-Bold', fillColor=BRANCO))
    return d


def tela_estoque():
    """Tela de estoque."""
    d = Drawing(212, 370)
    d.add(Rect(0, 0, 212, 370, fillColor=CINZA_CLARO, strokeColor=None))
    # Barra de pesquisa
    d.add(RoundRect(6, 342, 200, 22, 4,
                    fillColor=BRANCO, strokeColor=CINZA_BORD, strokeWidth=1))
    d.add(String(12, 350, '🔍  Pesquisar produto...', fontSize=8,
                 fontName='Helvetica', fillColor=CINZA_MED))
    # Chips de categoria
    cats = [('Bebidas', True), ('Frios', False), ('Secos', False), ('Carnes', False)]
    x = 6
    for cat, ativo in cats:
        w = len(cat) * 6 + 16
        cor = VERDE if ativo else BRANCO
        bord = VERDE if ativo else CINZA_BORD
        d.add(RoundRect(x, 322, w, 16, 8,
                        fillColor=cor, strokeColor=bord, strokeWidth=1))
        d.add(String(x + 8, 327, cat, fontSize=7,
                     fontName='Helvetica-Bold' if ativo else 'Helvetica',
                     fillColor=BRANCO if ativo else CINZA_MED))
        x += w + 4
    # Produtos em estoque
    prods = [
        ('Cerveja Heineken 600ml', '48 UN', True, '20'),
        ('Coca-Cola 2L', '12 UN', False, '6'),
        ('Água Mineral 500ml', '144 UN', True, '50'),
        ('Suco Del Valle 1L', '3 UN', False, '10'),
        ('Vinho Tinto Seco', '5 UN', True, '3'),
    ]
    for i, (nome, qtd, ok, minimo) in enumerate(prods):
        y = 300 - i * 40
        d.add(RoundRect(6, y, 200, 34, 4,
                        fillColor=BRANCO, strokeColor=CINZA_BORD, strokeWidth=0.5))
        cor_badge = VERDE if ok else VERMELHO
        d.add(RoundRect(164, y + 10, 40, 14, 7,
                        fillColor=VERDE_CLARO if ok else VERM_CLARO,
                        strokeColor=cor_badge, strokeWidth=0.5))
        d.add(String(170, y + 14, qtd, fontSize=7,
                     fontName='Helvetica-Bold', fillColor=cor_badge))
        d.add(String(12, y + 22, nome, fontSize=8,
                     fontName='Helvetica-Bold', fillColor=CINZA_ESC))
        d.add(String(12, y + 10, f'Mínimo: {minimo} UN', fontSize=7,
                     fontName='Helvetica', fillColor=CINZA_MED))
        if not ok:
            d.add(String(12, y + 2, '⚠ ABAIXO DO MÍNIMO', fontSize=6.5,
                         fontName='Helvetica-Bold', fillColor=VERMELHO))
    return d


def tela_saida():
    """Tela de saída (bipar produto)."""
    d = Drawing(212, 370)
    d.add(Rect(0, 0, 212, 370, fillColor=CINZA_CLARO, strokeColor=None))
    # Scanner area
    d.add(RoundRect(30, 270, 152, 90, 8,
                    fillColor=CINZA_ESC, strokeColor=None))
    # "visor" da câmera
    d.add(Rect(40, 278, 132, 74, fillColor=colors.HexColor('#263238'), strokeColor=None))
    # linhas de scan animadas
    for i in range(4):
        d.add(Line(50, 310 + i * 8, 172, 310 + i * 8,
                   strokeColor=colors.HexColor('#4DD0E1'), strokeWidth=0.8))
    # linha de foco
    d.add(Line(50, 315, 172, 315, strokeColor=VERDE_MED, strokeWidth=2))
    d.add(String(60, 282, '[ aponte para o código ]', fontSize=7,
                 fontName='Helvetica', fillColor=colors.HexColor('#80CBC4')))
    d.add(String(55, 356, '📷  Bipando produto...', fontSize=9,
                 fontName='Helvetica-Bold', fillColor=BRANCO))
    # Resultado do bipe
    d.add(RoundRect(6, 210, 200, 52, 6,
                    fillColor=VERDE_CLARO, strokeColor=VERDE, strokeWidth=1.5))
    d.add(String(14, 252, '✓  Produto reconhecido!', fontSize=9,
                 fontName='Helvetica-Bold', fillColor=VERDE))
    d.add(String(14, 240, 'Cerveja Heineken 600ml Long Neck', fontSize=8,
                 fontName='Helvetica-Bold', fillColor=CINZA_ESC))
    d.add(String(14, 228, 'Estoque atual: 48 UN', fontSize=8,
                 fontName='Helvetica', fillColor=CINZA_MED))
    d.add(String(14, 216, 'Categoria: Bebidas', fontSize=8,
                 fontName='Helvetica', fillColor=CINZA_MED))
    # Quantidade
    d.add(String(14, 196, 'Quantidade a retirar:', fontSize=8,
                 fontName='Helvetica-Bold', fillColor=CINZA_ESC))
    d.add(RoundRect(100, 185, 60, 20, 4,
                    fillColor=BRANCO, strokeColor=VERDE, strokeWidth=1.5))
    d.add(String(114, 191, '1', fontSize=11,
                 fontName='Helvetica-Bold', fillColor=CINZA_ESC))
    d.add(String(85, 191, '–', fontSize=14, fontName='Helvetica-Bold', fillColor=CINZA_MED))
    d.add(String(164, 191, '+', fontSize=14, fontName='Helvetica-Bold', fillColor=CINZA_MED))
    # Botão confirmar saída
    d.add(RoundRect(6, 155, 200, 24, 6, fillColor=VERDE, strokeColor=None))
    d.add(String(48, 163, 'CONFIRMAR RETIRADA', fontSize=8.5,
                 fontName='Helvetica-Bold', fillColor=BRANCO))
    # Histórico
    d.add(String(10, 144, 'Últimas retiradas de hoje:', fontSize=7.5,
                 fontName='Helvetica-Bold', fillColor=CINZA_MED))
    for i, (prod, qtd, hora) in enumerate([
        ('Coca-Cola 2L', '–2 UN', '14:32'),
        ('Arroz 5kg', '–1 SC', '13:15'),
    ]):
        y = 124 - i * 26
        d.add(RoundRect(6, y, 200, 20, 3,
                        fillColor=BRANCO, strokeColor=CINZA_BORD, strokeWidth=0.5))
        d.add(String(12, y + 12, prod, fontSize=7.5,
                     fontName='Helvetica-Bold', fillColor=CINZA_ESC))
        d.add(String(12, y + 3, hora, fontSize=7, fontName='Helvetica', fillColor=CINZA_MED))
        d.add(String(160, y + 7, qtd, fontSize=8,
                     fontName='Helvetica-Bold', fillColor=VERMELHO))
    return d


def tela_gpt():
    """Tela da esteira GPT."""
    d = Drawing(212, 370)
    d.add(Rect(0, 0, 212, 370, fillColor=CINZA_CLARO, strokeColor=None))
    # Card resumo
    d.add(RoundRect(6, 330, 200, 34, 6,
                    fillColor=AZUL_CLARO, strokeColor=AZUL_MED, strokeWidth=1))
    d.add(String(14, 354, '🤖  Esteira de Treinamento', fontSize=9,
                 fontName='Helvetica-Bold', fillColor=AZUL))
    d.add(String(14, 342, '3 produtos aguardando pesquisa do GPT', fontSize=8,
                 fontName='Helvetica', fillColor=CINZA_MED))
    # Produtos na fila
    pendentes = [
        ('Cerveja Heineken 600ml', 'embalagem, mapeamento'),
        ('Azeite Extra Virgem 500ml', 'embalagem'),
        ('Queijo Mussarela kg', 'embalagem, alias'),
    ]
    for i, (nome, pendente) in enumerate(pendentes):
        y = 290 - i * 44
        d.add(RoundRect(6, y, 200, 38, 4,
                        fillColor=BRANCO, strokeColor=LARANJA, strokeWidth=1))
        d.add(Circle(22, y + 28, 8, fillColor=LARANJA_CL, strokeColor=None))
        d.add(String(17, y + 25, str(i+1), fontSize=8,
                     fontName='Helvetica-Bold', fillColor=LARANJA))
        d.add(String(34, y + 28, nome, fontSize=8,
                     fontName='Helvetica-Bold', fillColor=CINZA_ESC))
        d.add(String(34, y + 16, f'Pendente: {pendente}', fontSize=7,
                     fontName='Helvetica', fillColor=LARANJA))
        d.add(String(34, y + 6, 'Status: aguardando GPT', fontSize=7,
                     fontName='Helvetica', fillColor=CINZA_MED))
    # Botão exportar
    d.add(RoundRect(6, 112, 200, 24, 6, fillColor=AZUL_MED, strokeColor=None))
    d.add(String(24, 120, '📤  EXPORTAR PACOTE PARA GPT', fontSize=8.5,
                 fontName='Helvetica-Bold', fillColor=BRANCO))
    # Botão importar
    d.add(RoundRect(6, 82, 200, 24, 6, fillColor=VERDE, strokeColor=None))
    d.add(String(24, 90, '📥  IMPORTAR RESPOSTA DO GPT', fontSize=8.5,
                 fontName='Helvetica-Bold', fillColor=BRANCO))
    d.add(String(10, 68, 'Após importar, esses produtos serão', fontSize=8,
                 fontName='Helvetica', fillColor=CINZA_MED))
    d.add(String(10, 57, 'reconhecidos automaticamente nas', fontSize=8,
                 fontName='Helvetica', fillColor=CINZA_MED))
    d.add(String(10, 46, 'próximas notas.', fontSize=8,
                 fontName='Helvetica', fillColor=CINZA_MED))
    return d


def tela_dashboard():
    """Tela do dashboard."""
    d = Drawing(212, 370)
    d.add(Rect(0, 0, 212, 370, fillColor=CINZA_CLARO, strokeColor=None))
    # Cards de stats
    cards = [
        ('265', 'Produtos', VERDE, VERDE_CLARO),
        ('R$ 48.200', 'Valor estoque', AZUL, AZUL_CLARO),
        ('12', 'Abaixo mínimo', VERMELHO, VERM_CLARO),
        ('8', 'NF-e este mês', LARANJA, LARANJA_CL),
    ]
    for i, (val, lbl, cor, fundo) in enumerate(cards):
        row, col = divmod(i, 2)
        x = 6 + col * 104
        y = 290 - row * 56
        d.add(RoundRect(x, y, 98, 48, 6, fillColor=fundo, strokeColor=cor, strokeWidth=0.5))
        d.add(String(x + 10, y + 30, val, fontSize=13,
                     fontName='Helvetica-Bold', fillColor=cor))
        d.add(String(x + 10, y + 16, lbl, fontSize=8,
                     fontName='Helvetica', fillColor=CINZA_MED))
    # Alerta de estoque baixo
    d.add(String(10, 226, '⚠  Produtos abaixo do mínimo', fontSize=8.5,
                 fontName='Helvetica-Bold', fillColor=VERMELHO))
    alertas = [
        ('Suco Del Valle 1L', '3 UN', '10 UN'),
        ('Vinho Tinto Seco', '2 UN', '5 UN'),
        ('Queijo Mussarela', '0,5 KG', '2 KG'),
    ]
    for i, (nome, atual, min_) in enumerate(alertas):
        y = 206 - i * 28
        d.add(RoundRect(6, y, 200, 22, 3,
                        fillColor=VERM_CLARO, strokeColor=VERMELHO, strokeWidth=0.5))
        d.add(String(12, y + 13, nome, fontSize=7.5,
                     fontName='Helvetica-Bold', fillColor=CINZA_ESC))
        d.add(String(12, y + 3, f'Atual: {atual}  |  Mínimo: {min_}', fontSize=7,
                     fontName='Helvetica', fillColor=CINZA_MED))
    # Últimas movimentações
    d.add(String(10, 114, 'Movimentações recentes', fontSize=8.5,
                 fontName='Helvetica-Bold', fillColor=CINZA_ESC))
    movs = [
        ('+50 UN', 'Cerveja Heineken 600ml', 'Entrada NF', VERDE),
        ('–2 UN', 'Coca-Cola 2L', 'Retirada', VERMELHO),
        ('+144 UN', 'Água Mineral 500ml', 'Entrada NF', VERDE),
    ]
    for i, (qtd, nome, tipo, cor) in enumerate(movs):
        y = 94 - i * 28
        d.add(RoundRect(6, y, 200, 22, 3,
                        fillColor=BRANCO, strokeColor=CINZA_BORD, strokeWidth=0.5))
        d.add(String(12, y + 13, nome, fontSize=7.5,
                     fontName='Helvetica-Bold', fillColor=CINZA_ESC))
        d.add(String(12, y + 3, tipo, fontSize=7,
                     fontName='Helvetica', fillColor=CINZA_MED))
        d.add(String(164, y + 9, qtd, fontSize=8,
                     fontName='Helvetica-Bold', fillColor=cor))
    return d


# ─── Página de capa ──────────────────────────────────────────────────────────

def capa(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(VERDE)
    canvas.rect(0, 0, W, H, fill=1, stroke=0)
    # Gradiente simulado com retângulos
    canvas.setFillColor(colors.HexColor('#1B5E20'))
    canvas.rect(0, H * 0.6, W, H * 0.4, fill=1, stroke=0)
    # Círculos decorativos
    canvas.setFillColor(colors.HexColor('#388E3C'))
    canvas.circle(W * 0.85, H * 0.85, 120, fill=1, stroke=0)
    canvas.setFillColor(colors.HexColor('#2E7D32'))
    canvas.circle(W * 0.1, H * 0.15, 80, fill=1, stroke=0)
    # Título
    canvas.setFillColor(BRANCO)
    canvas.setFont('Helvetica-Bold', 42)
    canvas.drawCentredString(W / 2, H * 0.62, 'Super Ajudante')
    canvas.setFont('Helvetica', 18)
    canvas.setFillColor(colors.HexColor('#C8E6C9'))
    canvas.drawCentredString(W / 2, H * 0.56, 'Controle de Estoque Inteligente')
    canvas.setFont('Helvetica', 13)
    canvas.drawCentredString(W / 2, H * 0.51, 'Manual do Usuário')
    # Linha separadora
    canvas.setStrokeColor(colors.HexColor('#A5D6A7'))
    canvas.setLineWidth(1)
    canvas.line(W * 0.2, H * 0.49, W * 0.8, H * 0.49)
    # Subtítulo
    canvas.setFillColor(colors.HexColor('#E8F5E9'))
    canvas.setFont('Helvetica', 11)
    canvas.drawCentredString(W / 2, H * 0.45,
        'Guia completo: entrada de notas, controle de estoque,')
    canvas.drawCentredString(W / 2, H * 0.42, 'retiradas e treinamento com inteligência artificial')
    # Versão
    canvas.setFillColor(colors.HexColor('#81C784'))
    canvas.setFont('Helvetica', 9)
    canvas.drawCentredString(W / 2, 40, 'Versão 1.0 · 2025')
    canvas.restoreState()


def rodape(canvas, doc):
    if doc.page == 1:
        return
    canvas.saveState()
    canvas.setStrokeColor(CINZA_BORD)
    canvas.setLineWidth(0.5)
    canvas.line(2 * cm, 1.8 * cm, W - 2 * cm, 1.8 * cm)
    canvas.setFillColor(CINZA_MED)
    canvas.setFont('Helvetica', 8)
    canvas.drawString(2 * cm, 1.2 * cm, 'Super Ajudante · Manual do Usuário')
    canvas.drawRightString(W - 2 * cm, 1.2 * cm, f'Página {doc.page - 1}')
    canvas.restoreState()


def primeira_pagina(canvas, doc):
    capa(canvas, doc)


def paginas_seguintes(canvas, doc):
    rodape(canvas, doc)


# ─── Bloco de dica ───────────────────────────────────────────────────────────

def tip(texto, cor=AZUL, fundo=AZUL_CLARO, icone='💡'):
    return Table(
        [[Paragraph(f'<b>{icone}</b>', S('Normal', fontSize=12, fontName='Helvetica')),
          Paragraph(texto, S('Normal', fontSize=10, fontName='Helvetica',
                              textColor=cor, leading=15))]],
        colWidths=[1.2 * cm, 14.5 * cm],
        style=TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), fundo),
            ('ROUNDEDCORNERS', [6]),
            ('BOX', (0, 0), (-1, -1), 1, cor),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
            ('RIGHTPADDING', (0, 0), (-1, -1), 8),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ])
    )


def secao_com_tela(titulo, descricao_col, tela_drawing, largura_tela=260):
    """Layout: texto à esquerda, tela de celular à direita."""
    cel_draw = Drawing(largura_tela, 450)
    frame = phone_frame(tela_drawing, width=212, height=370)
    frame.transform = (1, 0, 0, 1, 0, 0)
    cel_draw.add(frame)
    return Table(
        [[descricao_col, cel_draw]],
        colWidths=[10 * cm, largura_tela * 0.0352778 * cm + 1 * cm],
        style=TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (0, 0), (0, 0), 0),
            ('RIGHTPADDING', (0, 0), (0, 0), 10),
            ('LEFTPADDING', (1, 0), (1, 0), 0),
        ])
    )


# ─── Conteúdo ─────────────────────────────────────────────────────────────────

def build_story():
    story = []

    # ── CAPA (página 1 é tratada pelo firstPageTemplate) ──────────────────
    story.append(PageBreak())

    # ── ÍNDICE ────────────────────────────────────────────────────────────
    story.append(Paragraph('Índice', cap_titulo))
    story.append(HRFlowable(width='100%', thickness=1, color=VERDE, spaceAfter=10))
    indice = [
        ('1', 'O que é o Super Ajudante', '3'),
        ('2', 'Como dar entrada em uma Nota Fiscal', '4'),
        ('3', 'Tela de Conferência — revisando os produtos', '5'),
        ('4', 'Retirada de produtos — bipando o estoque', '6'),
        ('5', 'Treinamento com IA (ChatGPT)', '7'),
        ('6', 'O Dashboard — visão geral do estoque', '8'),
        ('7', 'Perguntas frequentes', '9'),
    ]
    for num, titulo, pag in indice:
        story.append(Table(
            [[Paragraph(f'<b>{num}.</b>', S('Normal', fontSize=11, fontName='Helvetica',
                                             textColor=VERDE)),
              Paragraph(titulo, S('Normal', fontSize=11, fontName='Helvetica',
                                  textColor=CINZA_ESC)),
              Paragraph(pag, S('Normal', fontSize=11, fontName='Helvetica',
                                textColor=CINZA_MED, alignment=TA_CENTER))]],
            colWidths=[1 * cm, 12.5 * cm, 2 * cm],
            style=TableStyle([
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('LINEBELOW', (0, 0), (-1, -1), 0.3, CINZA_BORD),
                ('TOPPADDING', (0, 0), (-1, -1), 5),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
            ])
        ))
    story.append(PageBreak())

    # ── CAPÍTULO 1: O QUE É ───────────────────────────────────────────────
    story.append(Paragraph('1. O que é o Super Ajudante', cap_titulo))
    story.append(HRFlowable(width='100%', thickness=1, color=VERDE, spaceAfter=10))
    story.append(Paragraph(
        'O <b>Super Ajudante</b> é um aplicativo para celular que ajuda o restaurante a controlar '
        'o estoque de forma simples e automática. Em vez de anotar tudo na mão ou digitar produto '
        'por produto em uma planilha, você <b>aponta a câmera para o QR Code da nota fiscal</b> — '
        'e o app faz quase tudo sozinho.', corpo))
    story.append(Spacer(1, 8))
    story.append(Paragraph('<b>O que o app faz automaticamente:</b>', sec_titulo))
    beneficios = [
        ('📦', 'Lê a nota fiscal', 'Baixa os dados direto da internet usando o código da nota'),
        ('🔍', 'Reconhece os produtos', 'Se o produto já foi cadastrado antes, o app identifica sozinho'),
        ('📊', 'Atualiza o estoque', 'As quantidades entram no estoque automaticamente ao confirmar'),
        ('💰', 'Calcula o custo médio', 'O custo de cada produto é recalculado a cada entrada'),
        ('📋', 'Registra o que foi retirado', 'Cada retirada fica registrada com data, hora e quantidade'),
        ('🤖', 'Aprende com o tempo', 'Quanto mais você usa, menos perguntas o app faz'),
    ]
    rows = [[
        Table([[Paragraph(ico, S('Normal', fontSize=16)), Paragraph(f'<b>{titulo}</b><br/>{desc}',
               S('Normal', fontSize=10, leading=14, textColor=CINZA_ESC))]],
              colWidths=[1 * cm, 5.5 * cm],
              style=TableStyle([('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                                ('LEFTPADDING', (0, 0), (-1, -1), 4)]))
        for ico, titulo, desc in beneficios[i:i+2]
    ] for i in range(0, len(beneficios), 2)]
    story.append(Table(rows, colWidths=[7.5 * cm, 7.5 * cm],
        style=TableStyle([
            ('BOX', (0, 0), (-1, -1), 0.5, CINZA_BORD),
            ('INNERGRID', (0, 0), (-1, -1), 0.3, CINZA_BORD),
            ('BACKGROUND', (0, 0), (-1, -1), VERDE_CLARO),
            ('ROWBACKGROUNDS', (0, 0), (-1, -1), [VERDE_CLARO, BRANCO]),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ])))
    story.append(Spacer(1, 12))
    story.append(tip(
        'O Super Ajudante funciona no celular Android e também pode ser acessado pelo navegador. '
        'Tudo fica salvo na nuvem — você pode consultar de qualquer lugar.',
        VERDE, VERDE_CLARO, '📱'))
    story.append(PageBreak())

    # ── CAPÍTULO 2: ENTRADA DE NOTA ───────────────────────────────────────
    story.append(Paragraph('2. Como dar entrada em uma Nota Fiscal', cap_titulo))
    story.append(HRFlowable(width='100%', thickness=1, color=VERDE, spaceAfter=10))

    passos_col = []
    passos_col.append(Paragraph(
        'Quando chega uma entrega com nota fiscal, é hora de registrar no app. '
        'O processo todo leva menos de 2 minutos.', corpo))
    passos_col.append(Spacer(1, 8))

    passos = [
        ('1', VERDE, 'Abra o app e toque em "Entrada de NF-e"',
         'No menu inferior, toque no ícone de nota fiscal.'),
        ('2', VERDE, 'Informe a nota de uma destas formas:',
         '• Escaneie o QR Code impresso na nota com a câmera\n'
         '• Digite a chave de 44 números\n'
         '• Selecione o arquivo .xml recebido por e-mail'),
        ('3', AZUL, 'Aguarde a busca automática',
         'O app busca os dados na internet. Leva alguns segundos.'),
        ('4', LARANJA, 'Revise a tela de Conferência',
         'Produtos conhecidos aparecem em verde. Produtos novos '
         'ficam em destaque — veja o próximo capítulo.'),
        ('5', VERDE, 'Toque em "Confirmar e Gravar"',
         'O estoque é atualizado automaticamente. Pronto!'),
    ]
    for num, cor, titulo, desc in passos:
        passos_col.append(Table([[
            Paragraph(num, S('Normal', fontSize=13, fontName='Helvetica-Bold',
                              textColor=BRANCO, alignment=TA_CENTER)),
            Paragraph(f'<b>{titulo}</b><br/>{desc}',
                      S('Normal', fontSize=10, leading=14, textColor=CINZA_ESC))
        ]], colWidths=[0.7 * cm, 9 * cm],
        style=TableStyle([
            ('BACKGROUND', (0, 0), (0, 0), cor),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('LEFTPADDING', (1, 0), (1, 0), 8),
            ('BOX', (0, 0), (-1, -1), 0.5, CINZA_BORD),
            ('LINEBELOW', (0, 0), (-1, -1), 0.3, CINZA_BORD),
        ])))
        passos_col.append(Spacer(1, 3))

    story.append(secao_com_tela('', passos_col, tela_entrada()))
    story.append(Spacer(1, 10))
    story.append(tip(
        '<b>Dica:</b> O QR Code fica no canto inferior direito do DANFE (o espelho da nota fiscal '
        'em papel). Você também pode receber o XML por e-mail do fornecedor.',
        AZUL, AZUL_CLARO, '💡'))
    story.append(PageBreak())

    # ── CAPÍTULO 3: CONFERÊNCIA ────────────────────────────────────────────
    story.append(Paragraph('3. Tela de Conferência — revisando os produtos', cap_titulo))
    story.append(HRFlowable(width='100%', thickness=1, color=VERDE, spaceAfter=10))

    conf_col = []
    conf_col.append(Paragraph(
        'Depois de buscar a nota, o app mostra uma lista com todos os produtos. '
        'Existem dois tipos:', corpo))
    conf_col.append(Spacer(1, 6))

    conf_col.append(Table([[
        Paragraph('✓', S('Normal', fontSize=14, fontName='Helvetica-Bold',
                           textColor=VERDE, alignment=TA_CENTER)),
        Paragraph('<b>Produto já conhecido (verde)</b><br/>'
                  'O app já sabe o que é. Não precisa fazer nada — só confirmar se as '
                  'quantidades e o custo estão corretos.',
                  S('Normal', fontSize=10, leading=14, textColor=CINZA_ESC))
    ]], colWidths=[0.8 * cm, 9 * cm],
    style=TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), VERDE_CLARO),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('BOX', (0, 0), (-1, -1), 1, VERDE_MED),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING', (1, 0), (1, 0), 8),
    ])))
    conf_col.append(Spacer(1, 6))
    conf_col.append(Table([[
        Paragraph('⚠', S('Normal', fontSize=14, fontName='Helvetica',
                           textColor=LARANJA, alignment=TA_CENTER)),
        Paragraph('<b>Produto novo (destaque laranja)</b><br/>'
                  'O app nunca viu este produto. Você precisa preencher '
                  'o nome interno e a categoria.',
                  S('Normal', fontSize=10, leading=14, textColor=CINZA_ESC))
    ]], colWidths=[0.8 * cm, 9 * cm],
    style=TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), LARANJA_CL),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('BOX', (0, 0), (-1, -1), 1, LARANJA),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING', (1, 0), (1, 0), 8),
    ])))
    conf_col.append(Spacer(1, 10))
    conf_col.append(Paragraph('<b>Para produtos novos, preencha:</b>', sec_titulo))

    campos = [
        ('Nome interno', 'Como o produto será chamado no restaurante.\nEx.: "Cerveja Heineken 600ml Long Neck"'),
        ('Categoria', 'Grupo do produto (Bebidas, Frios, Carnes…).\nObrigatório — sem ele não é possível confirmar.'),
        ('Unidade', 'Como o produto é controlado no estoque:\nUN (unidade), KG (quilo), L (litro).'),
        ('Fator de conversão', 'Quantas unidades tem na embalagem da nota.\nEx.: caixa com 24 garrafas → fator = 24.'),
    ]
    for campo, desc in campos:
        conf_col.append(Table([[
            Paragraph(f'<b>{campo}</b>', S('Normal', fontSize=10, fontName='Helvetica-Bold',
                                            textColor=CINZA_ESC)),
            Paragraph(desc, S('Normal', fontSize=9, leading=13, textColor=CINZA_MED))
        ]], colWidths=[3.5 * cm, 6.3 * cm],
        style=TableStyle([
            ('LINEBELOW', (0, 0), (-1, -1), 0.3, CINZA_BORD),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ])))

    story.append(secao_com_tela('', conf_col, tela_conferencia()))
    story.append(Spacer(1, 10))
    story.append(tip(
        '<b>Importante:</b> O app bloqueia a confirmação se algum produto novo estiver sem '
        'categoria. Isso é proposital — garante que o estoque nunca fique com produto "solto" '
        'sem classificação.',
        VERMELHO, VERM_CLARO, '🚫'))
    story.append(PageBreak())

    # ── CAPÍTULO 4: RETIRADA ──────────────────────────────────────────────
    story.append(Paragraph('4. Retirada de produtos — bipando o estoque', cap_titulo))
    story.append(HRFlowable(width='100%', thickness=1, color=VERDE, spaceAfter=10))

    ret_col = []
    ret_col.append(Paragraph(
        'Quando um produto é retirado do estoque (para uso na cozinha, para um pedido ou '
        'qualquer outra finalidade), basta bipar o código de barras com o celular. '
        'O estoque é descontado automaticamente.', corpo))
    ret_col.append(Spacer(1, 8))
    ret_col.append(Paragraph('<b>Passo a passo:</b>', sec_titulo))

    ret_passos = [
        ('1', 'Abra o app e vá em "Retirada"', VERDE),
        ('2', 'Aponte a câmera para o código de barras do produto', VERDE),
        ('3', 'O app mostra o produto identificado', AZUL),
        ('4', 'Ajuste a quantidade (padrão = 1)', AZUL),
        ('5', 'Toque em "Confirmar Retirada"', VERDE),
        ('6', 'O estoque é descontado na hora', VERDE),
    ]
    for num, texto, cor in ret_passos:
        ret_col.append(Table([[
            Paragraph(num, S('Normal', fontSize=10, fontName='Helvetica-Bold',
                              textColor=BRANCO, alignment=TA_CENTER)),
            Paragraph(texto, S('Normal', fontSize=10, leading=14, textColor=CINZA_ESC))
        ]], colWidths=[0.6 * cm, 9.2 * cm],
        style=TableStyle([
            ('BACKGROUND', (0, 0), (0, 0), cor),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
            ('LEFTPADDING', (1, 0), (1, 0), 10),
            ('LINEBELOW', (0, 0), (-1, -1), 0.3, CINZA_BORD),
        ])))
        ret_col.append(Spacer(1, 2))

    ret_col.append(Spacer(1, 10))
    ret_col.append(Paragraph('<b>O que fica registrado:</b>', sec_titulo))
    ret_col.append(Paragraph(
        'Cada retirada gera um registro com: produto, quantidade, data, hora e '
        'responsável pela retirada. Isso garante rastreabilidade total — você sempre '
        'sabe o que saiu, quando e por quem.', corpo))

    story.append(secao_com_tela('', ret_col, tela_saida()))
    story.append(Spacer(1, 10))
    story.append(tip(
        'Se o produto não tiver código de barras, você pode pesquisar pelo nome '
        'na barra de pesquisa. O app encontra pelo nome interno cadastrado.',
        AZUL, AZUL_CLARO, '🔍'))
    story.append(PageBreak())

    # ── CAPÍTULO 5: TREINAMENTO GPT ───────────────────────────────────────
    story.append(Paragraph('5. Treinamento com IA (ChatGPT)', cap_titulo))
    story.append(HRFlowable(width='100%', thickness=1, color=VERDE, spaceAfter=10))

    gpt_col = []
    gpt_col.append(Paragraph(
        'Quando um produto novo entra pela primeira vez, o app cria um cadastro básico. '
        'Mas para que o app reconheça esse produto automaticamente nas <i>próximas</i> notas — '
        'e saiba quantas unidades têm em cada embalagem — é preciso "treiná-lo" uma vez.', corpo))
    gpt_col.append(Spacer(1, 6))
    gpt_col.append(Paragraph(
        'Isso é feito com a ajuda do ChatGPT, que pesquisa as informações dos produtos '
        'e devolve tudo pronto para importar.', corpo))
    gpt_col.append(Spacer(1, 8))

    fluxo_gpt = [
        ('🤖', 'App junta os produtos novos', 'Automaticamente, ao confirmar a nota', AZUL_CLARO, AZUL),
        ('📤', 'Você exporta o pacote', 'Toque em "Exportar Pacote para GPT"', AZUL_CLARO, AZUL),
        ('💬', 'Cola no ChatGPT', 'Use o prompt do sistema e envie o pacote', LARANJA_CL, LARANJA),
        ('📥', 'Importa a resposta', 'Cole o JSON do GPT no app e importe', VERDE_CLARO, VERDE),
        ('✅', 'Pronto!', 'O produto agora é reconhecido automaticamente', VERDE_CLARO, VERDE),
    ]
    for ico, titulo, desc, fundo, cor in fluxo_gpt:
        gpt_col.append(Table([[
            Paragraph(ico, S('Normal', fontSize=14, alignment=TA_CENTER)),
            Paragraph(f'<b>{titulo}</b><br/>{desc}',
                      S('Normal', fontSize=10, leading=14, textColor=CINZA_ESC))
        ]], colWidths=[0.9 * cm, 8.9 * cm],
        style=TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), fundo),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('BOX', (0, 0), (-1, -1), 0.5, cor),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('LEFTPADDING', (1, 0), (1, 0), 8),
        ])))
        gpt_col.append(Spacer(1, 3))

    story.append(secao_com_tela('', gpt_col, tela_gpt()))
    story.append(Spacer(1, 10))
    story.append(tip(
        '<b>Resultado prático:</b> depois de 2 ou 3 ciclos de treinamento, quase todas '
        'as notas são importadas sem precisar preencher nada. O app aprende e não '
        'esquece — a inteligência fica salva para sempre.',
        VERDE, VERDE_CLARO, '🧠'))
    story.append(PageBreak())

    # ── CAPÍTULO 6: DASHBOARD ─────────────────────────────────────────────
    story.append(Paragraph('6. O Dashboard — visão geral do estoque', cap_titulo))
    story.append(HRFlowable(width='100%', thickness=1, color=VERDE, spaceAfter=10))

    dash_col = []
    dash_col.append(Paragraph(
        'A tela inicial do app é o Dashboard — um painel que mostra tudo que está '
        'acontecendo no estoque em tempo real.', corpo))
    dash_col.append(Spacer(1, 8))

    cards_info = [
        (VERDE, 'Total de produtos', 'Quantos produtos diferentes estão cadastrados e ativos.'),
        (AZUL, 'Valor em estoque', 'Soma do custo médio × quantidade de todos os produtos.'),
        (VERMELHO, 'Abaixo do mínimo', 'Produtos com estoque menor que o mínimo cadastrado.'),
        (LARANJA, 'Notas do mês', 'Quantas NF-e foram importadas no mês atual.'),
    ]
    for cor, titulo, desc in cards_info:
        dash_col.append(Table([[
            Paragraph('■', S('Normal', fontSize=14, fontName='Helvetica-Bold',
                              textColor=cor)),
            Paragraph(f'<b>{titulo}:</b> {desc}',
                      S('Normal', fontSize=10, leading=14, textColor=CINZA_ESC))
        ]], colWidths=[0.5 * cm, 9.3 * cm],
        style=TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('LINEBELOW', (0, 0), (-1, -1), 0.3, CINZA_BORD),
        ])))

    dash_col.append(Spacer(1, 10))
    dash_col.append(Paragraph('<b>Alertas automáticos:</b>', sec_titulo))
    dash_col.append(Paragraph(
        'Quando um produto fica abaixo do estoque mínimo, ele aparece em vermelho '
        'no Dashboard. Isso avisa a equipe que está na hora de pedir mais ao fornecedor.', corpo))
    dash_col.append(Spacer(1, 6))
    dash_col.append(Paragraph('<b>Histórico de movimentações:</b>', sec_titulo))
    dash_col.append(Paragraph(
        'O Dashboard também mostra as últimas entradas e saídas, com produto, '
        'quantidade e data. Qualquer movimentação fica registrada para consulta futura.', corpo))

    story.append(secao_com_tela('', dash_col, tela_dashboard()))
    story.append(PageBreak())

    # ── CAPÍTULO 7: FAQ ───────────────────────────────────────────────────
    story.append(Paragraph('7. Perguntas frequentes', cap_titulo))
    story.append(HRFlowable(width='100%', thickness=1, color=VERDE, spaceAfter=10))

    faqs = [
        ('O app não encontrou a nota fiscal. O que faço?',
         'A busca na internet pode levar alguns segundos. Aguarde e tente novamente. '
         'Se continuar sem resultado, verifique se os 44 números da chave estão corretos '
         'e se a nota já foi autorizada pela Receita Federal.'),
        ('Importei a nota com o fator errado. Como corrijo?',
         'Acesse o produto no estoque, toque em "Editar" e corrija a embalagem. '
         'Você pode criar uma nova embalagem com o fator correto (ex.: CX = 24 garrafas).'),
        ('Um produto apareceu como "novo" mas eu já o tenho cadastrado.',
         'Isso acontece quando o fornecedor muda o código do produto. '
         'Na tela de conferência, você pode vincular ao produto existente em vez de criar um novo. '
         'Depois do ciclo GPT, o app aprende e não vai mais perguntar.'),
        ('Tentei confirmar e apareceu "produto sem categoria". O que fazer?',
         'Na tela de conferência, localize os produtos com fundo laranja e selecione '
         'uma categoria para cada um. Sem categoria, o app bloqueia para evitar erros no estoque.'),
        ('Posso usar o app em mais de um celular?',
         'Sim. O Super Ajudante é um app na nuvem — todos os celulares veem o mesmo estoque '
         'em tempo real. Qualquer alteração feita em um aparelho aparece nos outros.'),
        ('Quanto tempo leva para o app "aprender" todos os produtos?',
         'Depende de quantos fornecedores você tem. Em geral, após 2 ou 3 ciclos de '
         'treinamento com o GPT (um por semana), a maioria das notas já importa '
         'sem precisar preencher nada.'),
        ('O que acontece se eu confirmar a mesma nota duas vezes?',
         'O app bloqueia automaticamente. Ele verifica se a chave da nota já foi importada '
         'e não deixa duplicar.'),
        ('Como consultar o histórico de entradas e saídas de um produto?',
         'Na tela de Estoque, toque no produto e selecione "Ver histórico". '
         'Aparece a lista completa de todas as movimentações com data, hora e origem.'),
    ]
    for i, (pergunta, resposta) in enumerate(faqs):
        story.append(KeepTogether([
            Table([[
                Paragraph('?', S('Normal', fontSize=14, fontName='Helvetica-Bold',
                                  textColor=BRANCO, alignment=TA_CENTER)),
                Paragraph(f'<b>{pergunta}</b>',
                          S('Normal', fontSize=11, fontName='Helvetica-Bold',
                            textColor=CINZA_ESC, leading=15))
            ]], colWidths=[0.8 * cm, 14.7 * cm],
            style=TableStyle([
                ('BACKGROUND', (0, 0), (0, 0), VERDE),
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('TOPPADDING', (0, 0), (-1, -1), 6),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
                ('LEFTPADDING', (1, 0), (1, 0), 8),
            ])),
            Table([[
                Paragraph('', S('Normal')),
                Paragraph(resposta, S('Normal', fontSize=10, leading=15,
                                       textColor=CINZA_ESC, alignment=TA_JUSTIFY))
            ]], colWidths=[0.8 * cm, 14.7 * cm],
            style=TableStyle([
                ('BACKGROUND', (0, 0), (-1, -1), CINZA_CLARO),
                ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ('TOPPADDING', (0, 0), (-1, -1), 6),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
                ('LEFTPADDING', (1, 0), (1, 0), 8),
                ('BOX', (0, 0), (-1, -1), 0.3, CINZA_BORD),
            ])),
            Spacer(1, 6),
        ]))

    return story


# ─── Gera o PDF ──────────────────────────────────────────────────────────────

output_path = '/home/user/Superajudante/Manual_SuperAjudante.pdf'

doc = SimpleDocTemplate(
    output_path,
    pagesize=A4,
    leftMargin=2 * cm, rightMargin=2 * cm,
    topMargin=2 * cm, bottomMargin=2.5 * cm,
    title='Super Ajudante — Manual do Usuário',
    author='Super Ajudante',
)

story = build_story()

doc.build(
    story,
    onFirstPage=primeira_pagina,
    onLaterPages=paginas_seguintes,
)

print(f'PDF gerado: {output_path}')
print(f'Tamanho: {os.path.getsize(output_path) / 1024:.0f} KB')
