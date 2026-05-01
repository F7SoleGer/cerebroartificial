(function () {
  const PAGE = (document.body && document.body.dataset.page) || 'home';

  /* ════════════════════════════════════════
     SUPABASE CONFIG (placeholders trocados no deploy)
  ════════════════════════════════════════ */
  const SUPABASE_URL      = '__SUPABASE_URL__';
  const SUPABASE_ANON_KEY = '__SUPABASE_ANON_KEY__';

  if (PAGE === 'cadastro' && (SUPABASE_URL.startsWith('__') || SUPABASE_ANON_KEY.startsWith('__'))) {
    console.error('[Método CA] Secrets não foram injetados no deploy.');
  }

  /* Supabase REST helpers (sem SDK — puro fetch) */
  async function supabaseInsert(table, row) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        'return=representation',
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `HTTP ${res.status}`);
    }
    return res.json();
  }

  async function supabaseGetEbook() {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/ebooks?ativo=eq.true&limit=1&select=url_download,titulo`,
      {
        headers: {
          'apikey':        SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
      }
    );
    if (!res.ok) throw new Error('Ebook não encontrado');
    const data = await res.json();
    if (!data.length) throw new Error('Nenhum ebook ativo cadastrado');
    return data[0];
  }

  /* ════════════════════════════════════════
     FORM SUBMIT (página cadastro)
  ════════════════════════════════════════ */
  let _submitting = false;

  async function submitCadastro(e) {
    e.preventDefault();
    if (_submitting) return;

    const nome  = document.getElementById('cad-nome').value.trim();
    const tel   = document.getElementById('cad-tel').value.trim();
    const email = document.getElementById('cad-email').value.trim();
    const ocup  = document.getElementById('cad-ocup').value;

    const btn     = document.getElementById('cad-btn');
    const loading = document.getElementById('cad-loading');
    const success = document.getElementById('cad-success');
    const errBox  = document.getElementById('cad-error');
    const errMsg  = document.getElementById('cad-error-msg');

    _submitting = true;
    btn.disabled = true;
    success.classList.remove('visible');
    errBox.classList.remove('visible');
    loading.classList.add('visible');

    try {
      await supabaseInsert('leads', {
        nome,
        telefone: tel,
        email,
        ocupacao: ocup,
        origem:   'site_metodo_ca',
        criado_em: new Date().toISOString(),
      });

      const ebook = await supabaseGetEbook();
      window.open(ebook.url_download, '_blank');

      loading.classList.remove('visible');
      success.classList.add('visible');
      document.getElementById('cad-form').reset();

    } catch (err) {
      loading.classList.remove('visible');
      errMsg.textContent = err.message || 'Erro inesperado. Tente novamente.';
      errBox.classList.add('visible');
      btn.disabled = false;
      console.error('[Método CA] Erro no cadastro:', err);
    } finally {
      _submitting = false;
    }
  }

  window.submitCadastro = submitCadastro;

  /* ════════════════════════════════════════
     CHECKOUT — dispatcher Hubmais (Zoop wrapper)
     Fluxo: insere pedido → chama edge function (PIX/cartão) →
            renderiza QR ou retorna sucesso/erro.
  ════════════════════════════════════════ */
  let _checkoutSubmitting = false;
  let _pixPollTimer = null;

  function readBuyerFields(form) {
    return {
      nome:  form.querySelector('#chk-nome').value.trim(),
      email: form.querySelector('#chk-email').value.trim(),
      tel:   form.querySelector('#chk-tel')?.value.trim() ?? '',
      cpf:   form.querySelector('#chk-cpf')?.value.trim() ?? '',
    };
  }

  function readCardFields(form) {
    const num   = form.querySelector('#chk-card-number')?.value || '';
    const name  = form.querySelector('#chk-card-name')?.value || '';
    const month = form.querySelector('#chk-card-month')?.value || '';
    const year  = form.querySelector('#chk-card-year')?.value || '';
    const cvv   = form.querySelector('#chk-card-cvv')?.value || '';
    const inst  = parseInt(form.querySelector('#chk-card-installments')?.value || '1', 10);
    return {
      number: num.replace(/\D/g, ''),
      holder_name: name.trim(),
      expiration_month: month.padStart(2, '0'),
      expiration_year: year,
      security_code: cvv.trim(),
      installments: Number.isFinite(inst) ? inst : 1,
    };
  }

  async function callEdge(name, body) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  }

  async function createPedido(form, formaPagamento) {
    const buyer = readBuyerFields(form);
    const installmentsEl = form.querySelector('#chk-card-installments');
    const installments = installmentsEl ? parseInt(installmentsEl.value, 10) : 1;

    const rows = await supabaseInsert('pedidos', {
      nome:            buyer.nome,
      email:           buyer.email,
      telefone:        buyer.tel,
      cpf:             buyer.cpf.replace(/\D/g, ''),
      produto_slug:    form.dataset.produtoSlug || '',
      produto_nome:    form.dataset.produtoNome || '',
      valor:           parseFloat(form.dataset.produtoValor || '0') || 0,
      installments:    Number.isFinite(installments) ? installments : 1,
      forma_pagamento: formaPagamento,
      origem:          'site_metodo_ca',
    });
    const pedido = Array.isArray(rows) ? rows[0] : rows;
    if (!pedido?.id) throw new Error('Não foi possível registrar o pedido.');
    return pedido.id;
  }

  function renderPixPanel(form, { emv, qrcode64 }) {
    const panel = form.querySelector('#chk-pix-panel');
    if (!panel) return;
    const qr = panel.querySelector('.checkout-pix-qr img');
    const emvEl = panel.querySelector('.checkout-pix-emv');
    qr.src = qrcode64.startsWith('data:')
      ? qrcode64
      : `data:image/svg+xml;base64,${qrcode64}`;
    emvEl.textContent = emv;
    panel.classList.add('visible');
  }

  function startPixPolling(form, pedidoId) {
    if (_pixPollTimer) clearInterval(_pixPollTimer);
    const statusEl = form.querySelector('.checkout-pix-status');
    _pixPollTimer = setInterval(async () => {
      try {
        const { status } = await callEdge('check-pix-status', { pedidoId });
        if (statusEl) statusEl.textContent = status === 'approved' ? 'Pagamento confirmado' : 'Aguardando pagamento';
        if (status === 'approved') {
          if (statusEl) statusEl.classList.add('approved');
          clearInterval(_pixPollTimer); _pixPollTimer = null;
          form.querySelector('#chk-success')?.classList.add('visible');
        }
      } catch (err) {
        console.warn('[Método CA] check-pix:', err);
      }
    }, 5000);
  }

  async function submitCheckout(e) {
    e.preventDefault();
    if (_checkoutSubmitting) return;
    const form = e.target;
    const pagamentoEl = form.querySelector('input[name="pagamento"]:checked');
    const formaPagamento = pagamentoEl ? pagamentoEl.value : 'gratuito';

    const btn     = form.querySelector('#chk-btn');
    const loading = form.querySelector('#chk-loading');
    const success = form.querySelector('#chk-success');
    const errBox  = form.querySelector('#chk-error');
    const errMsg  = form.querySelector('#chk-error-msg');

    _checkoutSubmitting = true;
    btn.disabled = true;
    success.classList.remove('visible');
    errBox.classList.remove('visible');
    loading.classList.add('visible');

    try {
      const pedidoId = await createPedido(form, formaPagamento);

      if (formaPagamento === 'pix') {
        const pix = await callEdge('create-pix-payment', { pedidoId });
        renderPixPanel(form, pix);
        startPixPolling(form, pedidoId);
      } else if (formaPagamento === 'cartao') {
        const card = readCardFields(form);
        if (card.number.length < 13) throw new Error('Número de cartão inválido.');
        if (!card.holder_name) throw new Error('Nome impresso no cartão é obrigatório.');
        if (!card.expiration_month || !card.expiration_year) throw new Error('Validade do cartão é obrigatória.');
        if (card.security_code.length < 3) throw new Error('CVV inválido.');
        const result = await callEdge('create-credit-payment', { pedidoId, card });
        if (result.status === 'succeeded' || result.status === 'authorized') {
          success.classList.add('visible');
          form.reset();
        } else {
          throw new Error('Cartão recusado pela operadora. Tente outro cartão.');
        }
      } else {
        // gratuito ou boleto — pedido registrado, retorno por e-mail
        success.classList.add('visible');
        form.reset();
      }

      loading.classList.remove('visible');
      btn.disabled = formaPagamento === 'pix';

    } catch (err) {
      loading.classList.remove('visible');
      errMsg.textContent = err.message || 'Erro inesperado. Tente novamente.';
      errBox.classList.add('visible');
      btn.disabled = false;
      console.error('[Método CA] Erro no checkout:', err);
    } finally {
      _checkoutSubmitting = false;
    }
  }

  function setupCheckoutPage() {
    if (PAGE !== 'checkout') return;
    const form = document.getElementById('chk-form');
    if (!form) return;

    // toggle card fields when 'cartao' is selected
    function toggleCardFields() {
      const selected = form.querySelector('input[name="pagamento"]:checked');
      const cardBlock = form.querySelector('#chk-card-fields');
      if (!cardBlock) return;
      cardBlock.classList.toggle('visible', !!(selected && selected.value === 'cartao'));
    }
    form.querySelectorAll('input[name="pagamento"]').forEach(r => r.addEventListener('change', toggleCardFields));
    toggleCardFields();

    // PIX copy button
    const copyBtn = form.querySelector('.checkout-pix-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const emv = form.querySelector('.checkout-pix-emv')?.textContent || '';
        if (!emv) return;
        try { await navigator.clipboard.writeText(emv); copyBtn.classList.add('copied'); copyBtn.textContent = 'Copiado'; setTimeout(() => { copyBtn.classList.remove('copied'); copyBtn.textContent = 'Copiar código PIX'; }, 2000); } catch {}
      });
    }
  }
  setupCheckoutPage();

  window.submitCheckout = submitCheckout;

  /* ════════════════════════════════════════
     NAVEGAÇÃO (URL real)
  ════════════════════════════════════════ */
  const PAGE_URLS = {
    home:        '/',
    conceito:    '/conceito/',
    metodo:      '/metodo/',
    ferramentas: '/ferramentas/',
    aplicacoes:  '/aplicacoes/',
    produtos:    '/produtos/',
    cadastro:    '/cadastro/',
  };
  window.goTo = function (pageId) {
    const url = PAGE_URLS[pageId] || '/';
    if (location.pathname !== url) location.href = url;
  };

  /* ════════════════════════════════════════
     SCROLL OBSERVER — fábrica única
  ════════════════════════════════════════ */
  const _pageConfigs = {
    conceito:    { scrollId: 'conceito-scroll', blockSel: '.concept-block', ctaSel: '.conceito-cta',    itemSel: '.prog-item', dataAttr: 'block', threshold: 0.25 },
    metodo:      { scrollId: 'metodo-scroll',   blockSel: '.phase-block',   ctaSel: '.metodo-cta',      itemSel: '.mt-item',   dataAttr: 'phase', threshold: 0.2  },
    ferramentas: { scrollId: 'ferr-scroll',     blockSel: '.ferr-block',    ctaSel: '.ferr-cta',        itemSel: '.fi-item',   dataAttr: 'ferr',  threshold: 0.2  },
    aplicacoes:  { scrollId: 'aplic-scroll',    blockSel: '.aplic-block',   ctaSel: '.aplic-cta-final', itemSel: '.ai-item',   dataAttr: 'aplic', threshold: 0.2  },
  };
  const _observers = {};

  function initPageObserver({ scrollId, blockSel, ctaSel, itemSel, dataAttr, threshold }) {
    if (_observers[scrollId]) _observers[scrollId].disconnect();

    const scroller = document.getElementById(scrollId);
    if (!scroller) return;
    const blocks   = document.querySelectorAll(blockSel);
    const cta      = ctaSel ? document.querySelector(ctaSel) : null;
    const items    = document.querySelectorAll(itemSel);

    const io = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          const idx = entry.target.dataset[dataAttr];
          if (idx !== undefined) {
            items.forEach(i => i.classList.remove('active'));
            if (items[idx]) items[idx].classList.add('active');
          }
        }
      });
    }, { root: scroller, threshold });

    blocks.forEach(b => io.observe(b));
    if (cta) io.observe(cta);
    _observers[scrollId] = io;
  }

  function scrollToSection(scrollId, dataAttr, idx) {
    const n      = parseInt(idx, 10);
    const block  = document.querySelector('[data-' + dataAttr + '="' + n + '"]');
    const scroll = document.getElementById(scrollId);
    if (block && scroll) scroll.scrollTo({ top: block.offsetTop - 80, behavior: 'smooth' });
  }

  window.scrollToBlock = idx => scrollToSection('conceito-scroll', 'block', idx);
  window.scrollToPhase = idx => scrollToSection('metodo-scroll',   'phase', idx);
  window.scrollToFerr  = idx => scrollToSection('ferr-scroll',     'ferr',  idx);
  window.scrollToAplic = idx => scrollToSection('aplic-scroll',    'aplic', idx);

  if (_pageConfigs[PAGE]) initPageObserver(_pageConfigs[PAGE]);

  /* ════════════════════════════════════════
     GLOBAL GRAPH CANVAS
  ════════════════════════════════════════ */
  const canvas = document.getElementById('graph-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const G = 'rgba(200,154,46,';
  const P = 'rgba(130,100,220,';
  const T = 'rgba(80,180,160,';
  const B = 'rgba(80,140,220,';
  const M = 'rgba(160,155,140,';

  const N = {
    SC:  0, MC:  1, INT: 2, CON: 3, ZK:  4, CAP: 5, ORG: 6, AMP: 7, DOT: 8, EST: 9,
    SIN: 10, ARQ: 11, CNX: 12, GRF: 13, LEI: 14, MEM: 15, PRD: 16, CTX: 17, NOT: 18, TAG: 19,
    PES: 20, REF: 21, ANL: 22, REV: 23, PRM: 24, INS: 25, DEC: 26, IDE: 27, ARG: 28, PAD: 29,
    STR: 30, FLX: 31, OBS: 32, CLA: 33, ITG: 34, CRI: 35, APR: 36, CUR: 37, RCP: 38, ESC: 39,
    TES: 40, AUT: 41, MET: 42, VIN: 43, FOC: 44, ONT: 45, VOC: 46, REP: 47, FBK: 48, ITR: 49,
  };

  const DEFS = [
    { label: 'Segundo Cérebro', c: G, r: 12, hub: true },
    { label: 'Método C.A',      c: G, r: 10, hub: true },
    { label: 'Inteligência',    c: B, r: 10, hub: true },
    { label: 'Conhecimento',    c: T, r: 7  },
    { label: 'Zettelkasten',    c: T, r: 6  },
    { label: 'Capturar',        c: M, r: 5  },
    { label: 'Organizar',       c: M, r: 5  },
    { label: 'Amplificar',      c: M, r: 5  },
    { label: 'Doutrina',        c: G, r: 7  },
    { label: 'Estratégia',      c: G, r: 6  },
    { label: 'Síntese',         c: B, r: 6  },
    { label: 'Arquivo',         c: P, r: 6  },
    { label: 'Conexões',        c: P, r: 5  },
    { label: 'Grafo',           c: P, r: 5  },
    { label: 'Leitura',         c: T, r: 5  },
    { label: 'Memória',         c: T, r: 5  },
    { label: 'Produção',        c: T, r: 5  },
    { label: 'Contexto',        c: M, r: 4  },
    { label: 'Notas',           c: M, r: 4  },
    { label: 'Tags',            c: M, r: 4  },
    { label: 'Pesquisa',        c: M, r: 4  },
    { label: 'Referências',     c: M, r: 4  },
    { label: 'Análise',         c: B, r: 5  },
    { label: 'Revisão',         c: P, r: 4  },
    { label: 'Prompts',         c: B, r: 5  },
    { label: 'Insights',        c: T, r: 6  },
    { label: 'Decisão',         c: M, r: 4  },
    { label: 'Ideia',           c: G, r: 5  },
    { label: 'Argumento',       c: G, r: 4  },
    { label: 'Padrão',          c: T, r: 5  },
    { label: 'Estrutura',       c: M, r: 5  },
    { label: 'Fluxo',           c: T, r: 4  },
    { label: 'Obsidian',        c: B, r: 6  },
    { label: 'Claude',          c: B, r: 6  },
    { label: 'Integração',      c: P, r: 5  },
    { label: 'Criatividade',    c: T, r: 5  },
    { label: 'Aprendizado',     c: T, r: 4  },
    { label: 'Curadoria',       c: G, r: 4  },
    { label: 'Recuperação',     c: M, r: 4  },
    { label: 'Escrita',         c: G, r: 5  },
    { label: 'Tese',            c: G, r: 4  },
    { label: 'Automação',       c: B, r: 5  },
    { label: 'Metadados',       c: M, r: 3  },
    { label: 'Vínculo',         c: P, r: 4  },
    { label: 'Foco',            c: T, r: 3  },
    { label: 'Ontologia',       c: P, r: 4  },
    { label: 'Vocabulário',     c: M, r: 4  },
    { label: 'Repetição',       c: T, r: 3  },
    { label: 'Feedback',        c: M, r: 3  },
    { label: 'Iteração',        c: B, r: 3  },
  ];

  const { SC,MC,INT,CON,ZK,CAP,ORG,AMP,DOT,EST,SIN,ARQ,CNX,GRF,
          LEI,MEM,PRD,CTX,NOT,TAG,PES,REF,ANL,REV,PRM,INS,DEC,IDE,ARG,PAD,
          STR,FLX,OBS,CLA,ITG,CRI,APR,CUR,RCP,ESC,TES,AUT,MET,VIN,FOC,ONT,VOC,REP,FBK,ITR } = N;

  const LINKS = [
    [SC,MC],[SC,INT],[SC,CON],[SC,DOT],[SC,LEI],[SC,MEM],[SC,PRD],[SC,INS],[SC,PAD],[SC,OBS],[SC,CLA],
    [MC,ARQ],[MC,CNX],[MC,GRF],[MC,CAP],[MC,ORG],[MC,AMP],[MC,REV],[MC,NOT],[MC,TAG],[MC,PES],[MC,REF],[MC,STR],
    [INT,SIN],[INT,ANL],[INT,PRM],[INT,CON],[INT,CLA],[INT,AUT],
    [CON,ZK],[CON,LEI],[CON,INS],[CON,APR],[CON,ONT],
    [LEI,MEM],[LEI,APR],[LEI,REP],[LEI,CUR],
    [MEM,PRD],[MEM,REP],[MEM,FOC],[MEM,RCP],
    [ZK,NOT],[ZK,TAG],[ZK,ONT],
    [APR,REP],[APR,FOC],
    [PRD,IDE],[PRD,ESC],[PRD,FBK],[PRD,ITR],
    [INS,PAD],[INS,PRD],[INS,LEI],[INS,CRI],
    [IDE,CRI],[IDE,ESC],[IDE,VIN],
    [ESC,ARG],[ESC,SIN],[ESC,TES],
    [ARG,DOT],[ARG,TES],
    [SIN,ANL],[SIN,MC],
    [TES,DOT],[TES,ANL],
    [OBS,ARQ],[OBS,CNX],[OBS,GRF],[OBS,NOT],[OBS,ITG],[OBS,VIN],
    [CLA,PRM],[CLA,ANL],[CLA,AUT],[CLA,ITG],
    [ITG,AUT],[ITG,MC],
    [ARQ,CNX],[ARQ,GRF],[ARQ,NOT],[ARQ,RCP],[ARQ,MET],
    [STR,CAP],[STR,FLX],[STR,VOC],
    [CAP,FLX],[CAP,CUR],[CAP,MET],
    [NOT,MET],[NOT,TAG],[NOT,VOC],
    [TAG,ONT],[TAG,MET],
    [CTX,MC],[CTX,SC],[CTX,FOC],
    [FOC,FLX],[FOC,PRD],
    [FLX,ITR],[ORG,STR],[ORG,FLX],
    [DOT,EST],[DOT,IDE],[DOT,RCP],
    [EST,DEC],
    [AUT,PRM],[AUT,FBK],[AUT,ITR],
    [PRM,SIN],[PRM,ANL],
    [ANL,FBK],[ANL,DEC],[ANL,ITR],
    [AMP,CLA],[AMP,AUT],[AMP,INT],
    [REF,PES],[REF,CUR],
    [PES,RCP],[RCP,MEM],
    [DEC,SC],[DEC,CON],
    [CRI,INS],[CRI,CNX],[CRI,ESC],
    [CUR,VOC],[CUR,REF],
    [REP,NOT],
    [FBK,DEC],
    [VIN,CNX],[VIN,GRF],
    [ONT,CON],
    [VOC,MC],
    [PAD,INS],[PAD,CON],
    [REV,MC],[REV,NOT],
  ];

  let W, H, nodes = [];
  const mouse = { x: -9999, y: -9999 };

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function build() {
    const cx = W / 2, cy = H / 2;
    nodes = DEFS.map((d, i) => {
      const angle  = (i / DEFS.length) * Math.PI * 2;
      const orbit  = d.hub ? 120 : 80 + Math.random() * 340;
      const jitter = d.hub ? 0 : (Math.random() - 0.5) * 70;
      return {
        ...d,
        x:  cx + Math.cos(angle) * orbit + jitter,
        y:  cy + Math.sin(angle) * orbit + jitter,
        vx: (Math.random() - 0.5) * 0.16,
        vy: (Math.random() - 0.5) * 0.16,
        phase: Math.random() * Math.PI * 2,
        spd:   0.26 + Math.random() * 0.4,
        pulse: 0,
        glow:  false,
        ox: 0, oy: 0,
      };
    });
  }

  let ai = 0;
  let glowAccum = 0;
  let t = 0;

  function tick(now = performance.now()) {
    const dt = now - (tick._last ?? now);
    tick._last = now;

    glowAccum += dt;
    if (glowAccum >= 1000) {
      glowAccum = 0;
      if (nodes[ai]) nodes[ai].glow = false;
      ai = Math.floor(Math.random() * nodes.length);
      if (nodes[ai]) { nodes[ai].glow = true; nodes[ai].pulse = 1; }
    }

    ctx.clearRect(0, 0, W, H);
    t += 0.008;

    nodes.forEach(n => {
      n.ox = Math.sin(t * n.spd + n.phase) * 8;
      n.oy = Math.cos(t * n.spd * 0.72 + n.phase) * 6;
      n.x += n.vx; n.y += n.vy;
      if (n.x < 50 || n.x > W - 50) n.vx *= -1;
      if (n.y < 50 || n.y > H - 50) n.vy *= -1;
      if (n.pulse > 0) n.pulse -= 0.014;

      const nx = n.x + n.ox, ny = n.y + n.oy;
      const dx = nx - mouse.x, dy = ny - mouse.y;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d < 140 && d > 0) {
        const f = (140 - d) / 140 * 0.85;
        n.vx += (dx / d) * f; n.vy += (dy / d) * f;
        n.vx = Math.max(-1.5, Math.min(1.5, n.vx));
        n.vy = Math.max(-1.5, Math.min(1.5, n.vy));
      }
    });

    LINKS.forEach(([a, b]) => {
      const na = nodes[a], nb = nodes[b];
      if (!na || !nb) return;
      const ax = na.x + na.ox, ay = na.y + na.oy;
      const bx = nb.x + nb.ox, by = nb.y + nb.oy;
      const dist  = Math.hypot(bx - ax, by - ay);
      const alpha = Math.max(0, 1 - dist / 600);
      const hot   = na.glow || nb.glow;

      ctx.beginPath();
      ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
      ctx.strokeStyle = hot ? G + (alpha * 0.72) + ')' : M + (alpha * 0.28) + ')';
      ctx.lineWidth   = hot ? 1.3 : 0.65;
      ctx.stroke();

      if (hot && alpha > 0.28) {
        const p = (t * 0.72) % 1;
        ctx.beginPath();
        ctx.arc(ax + (bx - ax) * p, ay + (by - ay) * p, 1.8, 0, Math.PI * 2);
        ctx.fillStyle = G + '0.95)';
        ctx.fill();
      }
    });

    nodes.forEach(n => {
      const nx = n.x + n.ox, ny = n.y + n.oy;
      const r  = n.r + (n.hub ? 2 : 0);
      const pl = Math.max(0, n.pulse);

      if (n.glow || pl > 0) {
        const grd = ctx.createRadialGradient(nx, ny, r * 0.5, nx, ny, r * 4);
        grd.addColorStop(0, n.c + (0.3 + pl * 0.28) + ')');
        grd.addColorStop(1, n.c + '0)');
        ctx.beginPath();
        ctx.arc(nx, ny, r * 4, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();
      }

      if (n.hub) {
        ctx.beginPath();
        ctx.arc(nx, ny, r + 5, 0, Math.PI * 2);
        ctx.strokeStyle = n.c + '0.18)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      const g2 = ctx.createRadialGradient(nx - r * 0.3, ny - r * 0.3, 0, nx, ny, r);
      g2.addColorStop(0, n.c + (n.glow ? 1 : 0.88) + ')');
      g2.addColorStop(1, n.c + (n.glow ? 0.62 : 0.35) + ')');
      ctx.beginPath();
      ctx.arc(nx, ny, r, 0, Math.PI * 2);
      ctx.fillStyle = g2;
      ctx.fill();

      if (n.r >= 6) {
        ctx.font = n.hub
          ? '500 11px "DM Sans",sans-serif'
          : '300 9.5px "DM Sans",sans-serif';
        ctx.textAlign  = 'center';
        ctx.fillStyle  = n.c + (n.glow ? 0.95 : 0.55) + ')';
        ctx.fillText(n.label, nx, ny + r + 13);
      }
    });

    requestAnimationFrame(tick);
  }

  document.addEventListener('mousemove', e => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });

  window.addEventListener('resize', () => { resize(); build(); });
  resize(); build(); tick();
})();
