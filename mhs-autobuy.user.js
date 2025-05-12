// ==UserScript==
// @name         米画师自动购买橱窗脚本
// @namespace    https://github.com/y12rf/mhs-autobuy
// @version      1.9.4
// @description  自动购买米画师橱窗作品
// @license      MIT
// @author       和川 & ChatGPT‑Assist
// @match        *://www.mihuashi.com/stalls/*
// @updateURL    https://raw.githubusercontent.com/y12rf/mhs-autobuy/refs/heads/main/mhs-autobuy.meta.js
// @downloadURL  https://raw.githubusercontent.com/y12rf/mhs-autobuy/refs/heads/main/mhs_autobuy.user.js
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  /* ─────────── Stealth & UI Host Setup ─────────── */
  const SCRIPT_UNIQUE_PREFIX = 'mhs_helper_' + Math.random().toString(36).substring(2, 9);
  let scriptHostElement = null; // UI宿主元素
  let shadowRoot = null;      // Shadow DOM的根

  function initializeScriptUIHost() {
    if (document.getElementById(SCRIPT_UNIQUE_PREFIX + '_host')) {
        scriptHostElement = document.getElementById(SCRIPT_UNIQUE_PREFIX + '_host');
    } else {
        scriptHostElement = document.createElement('div');
        scriptHostElement.id = SCRIPT_UNIQUE_PREFIX + '_host';
        document.body.appendChild(scriptHostElement);
    }
    // scriptHostElement.style.display = 'none';

    shadowRoot = scriptHostElement.attachShadow({ mode: 'open' });

    const styleReset = document.createElement('style');
    styleReset.textContent = `
      :host {
        all: initial;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
      }
      /* Shadow DOM内部通用元素的基础样式 */
      div, span, h3, button, input, label, p, strong {
        box-sizing: border-box;
        font-family: inherit;
        color: #333;
      }
      button {
        cursor: pointer;
      }
    `;
    shadowRoot.appendChild(styleReset);
  }

  // Shadow DOM内部查询辅助函数
  const S = (selector) => shadowRoot ? shadowRoot.querySelector(selector) : null;
  const SAll = (selector) => shadowRoot ? shadowRoot.querySelectorAll(selector) : [];
  const S_ID = (id) => shadowRoot ? shadowRoot.getElementById(id) : null;


  /* ─────────── 配置 ─────────── */
  const config = {
    autoBuy: false,
    buyDelay: 1000,
    autoConfirm: false,
    showNotification: true,
    autoInputPassword: false,
    payPassword: '',
    autoAgreeTerms: true,
    enableStockCheck: true,
    showDebugLogs: false,
    enableAutoRefresh: true,
    autoRefreshInterval: 30000,
    saveStateBeforeRefresh: true,
    randomizeRefreshInterval: true
  };

  let isBuying = false;

  /* ─────────── 日志 ─────────── */
  const Logger = {
    el: null,
    logElementId: 'mhs_debug_log_shadow', // 在Shadow DOM内部使用的ID
    init() {
      // el的创建和样式设置保留，但不附加到任何地方
      // 它将在addPanel时被获取并附加到面板内部
      this.el = document.createElement('div');
      this.el.id = this.logElementId;
      Object.assign(this.el.style, {
        width: '100%',
        maxHeight: '150px',
        overflowY: 'auto',
        background: 'rgba(0,0,0,.7)', color: '#fff',
        padding: '10px', borderRadius: '5px',
        fontFamily: 'monospace', fontSize: '12px',
        marginTop: '10px',
        borderTop: '1px solid #555',
        display: config.showDebugLogs ? 'block' : 'none'
      });
    },
    log(msg) {
      console.log(`[MHS AutoBuy] ${msg}`);
      if (!config.showDebugLogs || !this.el) return;
      const now = new Date();
      const ts = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes()
        .toString()
        .padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
      const div = document.createElement('div');
      Object.assign(div.style, { borderBottom: '1px solid rgba(255,255,255,.2)', padding: '3px 0', color: '#fff' });
      div.textContent = `[${ts}] ${msg}`;
      this.el.appendChild(div);
      this.el.scrollTop = this.el.scrollHeight;
      while (this.el.children.length > 20) this.el.firstChild.remove();
    },
    toggle() {
      config.showDebugLogs = !config.showDebugLogs;
      if (this.el) {
        this.el.style.display = config.showDebugLogs ? 'block' : 'none';
      }
      saveCfg();
      return config.showDebugLogs;
    },
    clear() { if (this.el) this.el.innerHTML = ''; }
  };

  /* ─────────── 工具 ─────────── */
  const saveCfg = () => {
    try {
      localStorage.setItem('mihuashi_auto_buy', JSON.stringify(config));
    } catch (e) {
      Logger.log(`保存配置错误: ${e}`);
    }
  };

  // waitFor 操作的是页面元素，保持 document.querySelector
  const waitFor = (sel, t = 10000) =>
    new Promise((res, rej) => {
      const found = document.querySelector(sel);
      if (found && found.offsetParent !== null) return res(found);

      let timeoutId = null;
      const ob = new MutationObserver(() => {
        const n = document.querySelector(sel);
        if (n && n.offsetParent !== null) {
          ob.disconnect();
          clearTimeout(timeoutId);
          res(n);
        }
      });

      ob.observe(document.body, { childList: true, subtree: true, attributes: true });

      const initialCheck = document.querySelector(sel);
      if (initialCheck && initialCheck.offsetParent !== null) {
          ob.disconnect();
          res(initialCheck);
          return;
      }

      timeoutId = setTimeout(() => {
        ob.disconnect();
        const elementExistsButNotVisible = document.querySelector(sel);
        if (elementExistsButNotVisible) {
            rej(new Error(`等待元素 ${sel} 超时 (元素存在但不可见)`));
        } else {
            rej(new Error(`等待元素 ${sel} 超时 (元素未找到)`));
        }
      }, t);
    });

  let toastContainer = null;
  const TOAST_CONTAINER_ID = SCRIPT_UNIQUE_PREFIX + '_toast_container';

  function initToastContainer() {
    if (document.getElementById(TOAST_CONTAINER_ID)) {
        toastContainer = document.getElementById(TOAST_CONTAINER_ID);
        return;
    }

    toastContainer = document.createElement('div');
    toastContainer.id = TOAST_CONTAINER_ID;
    Object.assign(toastContainer.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      zIndex: 99999,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      gap: '10px'
    });
    document.body.appendChild(toastContainer); // Toast还是在主DOM，以确保全局覆盖
  }

  const toast = (msg, type = 'info') => {
    if (!config.showNotification) return;
    if (!toastContainer) { // 确保容器已初始化 (initToastContainer会处理)
        initToastContainer();
    }

    Logger.log(`通知: ${msg} (${type})`);
    const n = document.createElement('div');
    Object.assign(n.style, {
      padding: '10px 20px',
      borderRadius: '6px',
      color: '#fff',
      background: { success: '#4caf50', error: '#f44336', warning: '#ff9800', info: '#2196f3' }[type] || '#2196f3',
      boxShadow: '0 4px 12px rgba(0,0,0,.15)',
      transition: 'opacity 0.35s ease-out, transform 0.35s ease-out, margin-top 0.3s ease-out',
      opacity: '0',
      transform: 'translateX(110%)',
      minWidth: '200px',
      maxWidth: '320px',
      textAlign: 'left',
      wordBreak: 'break-word'
    });
    n.textContent = msg;
    toastContainer.prepend(n);

    setTimeout(() => {
        n.style.opacity = '1';
        n.style.transform = 'translateX(0)';
    }, 50);

    const VISIBLE_DURATION = 3000;
    const FADE_OUT_DURATION = 350;

    setTimeout(() => {
      n.style.opacity = '0';
      n.style.transform = 'translateX(110%)';
      setTimeout(() => {
          n.remove();
      }, FADE_OUT_DURATION);
    }, VISIBLE_DURATION);
  };

  /* ─────────── 核心逻辑 ─────────── */
  const hasStock = () =>
    !!Array.from(document.querySelectorAll('span, button')) // 页面元素
           .find((el) => el.textContent && el.textContent.includes('立即购买') && el.offsetParent !== null);

  const clickBuy = () => {
    const btn = Array.from(document.querySelectorAll('span, button')) // 页面元素
                     .find((el) => el.textContent && el.textContent.includes('立即购买') && el.offsetParent !== null);
    if (btn) {
      btn.click();
      toast('已点击购买按钮', 'success');
      return true;
    }
    toast('购买按钮不存在或不可见', 'error');
    return false;
  };

  const checkBalance = async () => {
    Logger.log('开始检查余额 (等待支付弹窗/提示)...');
    try {
        const tipBlockSelector = '.tip-block:has(i.icon-tip-info-circle)'; // 页面元素
        let tipElement;

        try {
            tipElement = await waitFor(tipBlockSelector, 3000); // waitFor 使用 document.querySelector
        } catch (e) {
            Logger.log(`等待余额提示块 ("${tipBlockSelector}") 超时或未找到可见元素: ${e.message}. 假设余额充足或UI不同.`);
            return true;
        }

        const tipText = tipElement.textContent;
        Logger.log(`找到提示块，内容: "${tipText}"`);

        if (tipText && tipText.includes('余额不足')) {
            const amtMatch = tipText.match(/还需充值\s*￥(\d+(\.\d+)?)/) || tipText.match(/￥(\d+(\.\d+)?)/);
            const amt = amtMatch ? amtMatch[1] : '?';

            toast(`账户余额不足，还需充值 ￥${amt}`, 'warning');
            Logger.log('余额不足，触发熔断机制。');
            config.autoBuy = false;

            if (config.enableAutoRefresh) {
                config.enableAutoRefresh = false;
                clearTimeout(window._autoRf); // window._autoRf/cd 是全局的，这里先保留
                clearInterval(window._cd);   // 后续可以考虑也移到脚本内部管理
                const countdownEl = S_ID('refresh-countdown'); // 从Shadow DOM获取
                if (countdownEl) countdownEl.style.display = 'none';

                // 使用 S (shadowRoot.querySelector) 来获取按钮
                const refreshTogButton = S('button[data-label="自动刷新"]');
                if (refreshTogButton && typeof refreshTogButton.sync === 'function') {
                    refreshTogButton.sync();
                } else {
                    const refBtnFallback = Array.from(SAll('button')) // 从Shadow DOM获取
                                             .find(b => b.textContent && b.textContent.startsWith('自动刷新'));
                    if (refBtnFallback) refBtnFallback.textContent = '自动刷新: 关闭';
                }
            }
            saveCfg();
            const panelAutoBuyToggle = S('button[data-label="自动模式"]'); // 从Shadow DOM获取
            if (panelAutoBuyToggle && typeof panelAutoBuyToggle.sync === 'function') {
                panelAutoBuyToggle.sync();
            }
            toast('已暂停自动购买和刷新，充值后面板可手动开启。', 'warning');
            return false;
        }
        Logger.log('提示块内容不包含 "余额不足". 假设余额充足。');
        return true;
    } catch (error) {
        Logger.log(`检查余额时发生错误: ${error.message || error}`);
        return true;
    }
  };

  const agreeTerms = () => { // 操作页面元素
    const checkboxContainer = Array.from(document.querySelectorAll('.el-checkbox'))
                                   .find(cb => cb.textContent && cb.textContent.includes('同意') || cb.querySelector('input[type="checkbox"]'));
    if (checkboxContainer) {
        const checkboxInput = checkboxContainer.querySelector('.el-checkbox__input');
        const actualCheckbox = checkboxContainer.querySelector('input[type="checkbox"]');
        if (checkboxInput && !checkboxInput.classList.contains('is-checked') && actualCheckbox && !actualCheckbox.checked) {
            const label = checkboxContainer.querySelector('.el-checkbox__label') || checkboxContainer;
            label.click();
            Logger.log('已尝试同意服务条款。');
            return true;
        }
        Logger.log('服务条款已同意或无法找到未勾选的复选框。');
    } else {
        Logger.log('未能找到同意服务条款的复选框。');
    }
    return false;
  };

  const fillPwd = async () => { // 操作页面元素
    if (!config.autoInputPassword || !config.payPassword) return;
    try {
      const box = await waitFor('.password-input__hidden-input', 2000); // waitFor 使用 document.querySelector
      box.focus();
      box.value = config.payPassword;
      box.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      box.dispatchEvent(new Event('change', { bubbles: true }));
      toast('已自动输入支付密码', 'success');
    } catch (err) {
      Logger.log(`自动输入密码失败: ${err.message || err}`);
    }
  };

  /* ─────────── 自动刷新 ─────────── */
  const updateCountdown = (sec) => {
    const el = S_ID('refresh-countdown'); // 从Shadow DOM获取
    if (!el) return;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    el.textContent = `刷新倒计时: ${m}:${s.toString().padStart(2, '0')}`;
  };

  const startRefresh = () => {
    clearTimeout(window._autoRf); // 全局计时器引用，暂不改动
    clearInterval(window._cd);

    if (!config.enableAutoRefresh) {
      Logger.log('自动刷新已禁用，不启动新的刷新周期。');
      const countdownEl = S_ID('refresh-countdown'); // 从Shadow DOM获取
      if(countdownEl) countdownEl.style.display = 'none';
      return;
    }

    let delay = config.autoRefreshInterval;
    if (config.randomizeRefreshInterval) {
      delay = Math.max(2000, Math.round(delay * (0.8 + Math.random() * 0.4)));
    }

    let left = Math.ceil(delay / 1000);
    updateCountdown(left);
    const countdownEl = S_ID('refresh-countdown'); // 从Shadow DOM获取
    if(countdownEl) countdownEl.style.display = 'block'; // 确保显示

    window._cd = setInterval(() => {
      left--;
      updateCountdown(left);
      if (left <= 0) {
        clearInterval(window._cd);
      }
    }, 1000);

    Logger.log(`下一次刷新 ${Math.ceil(delay / 1000)} 秒后`);
    window._autoRf = setTimeout(async () => {
      if (!config.enableAutoRefresh) {
        Logger.log('刷新动作执行前检测到自动刷新已禁用。');
        clearInterval(window._cd);
        const cdEl = S_ID('refresh-countdown'); // 从Shadow DOM获取
        if(cdEl) cdEl.style.display = 'none';
        return;
      }

      if (config.autoBuy && !isBuying && (!config.enableStockCheck || hasStock())) {
        Logger.log('自动刷新检测到可购买，尝试执行购买流程...');
        await buyFlow();
        if (config.enableAutoRefresh) {
          Logger.log('购买流程结束后，重新启动刷新周期。');
          startRefresh();
        } else {
          Logger.log('购买流程结束后，自动刷新已禁用，不继续刷新。');
          clearInterval(window._cd);
          const cdEl = S_ID('refresh-countdown'); // 从Shadow DOM获取
          if(cdEl) cdEl.style.display = 'none';
        }
        return;
      }

      if (config.enableAutoRefresh) {
          toast('页面即将刷新...', 'info');
          if (config.saveStateBeforeRefresh) saveCfg();
          setTimeout(() => location.reload(), 500);
      } else {
          Logger.log('自动刷新已禁用，不执行页面刷新。');
      }
    }, delay);
  };

  const updateStockBar = () => {
    const el = S_ID('stock-status'); // 从Shadow DOM获取
    if (!el) return false;
    const isAvailable = hasStock(); // hasStock 检查的是页面购买按钮
    el.textContent = `库存状态: ${isAvailable ? '有货' : '无货'}`;
    el.style.background = isAvailable ? '#4caf50' : '#f44336';
    el.style.color = '#fff'; // 确保文字颜色在背景上可见
    return isAvailable;
  };

  /* ─────────── 购买流程 ─────────── */
  const buyFlow = async () => {
    if (isBuying) {
      Logger.log('购买流程已在进行中，本次触发被忽略。');
      return;
    }
    isBuying = true;
    Logger.log('进入购买流程 (isBuying = true)');

    try {
      if (config.enableStockCheck && !hasStock()) {
        toast('当前无货 (buyFlow 入口检查)', 'error');
        return;
      }

      Logger.log('开始购买流程');
      toast('开始购买流程', 'info');

      if (!clickBuy()) { // clickBuy 操作页面
        return;
      }

      if (!await checkBalance()) { // checkBalance 已适配Shadow DOM UI交互
        return;
      }

      if(config.autoAgreeTerms) agreeTerms(); // agreeTerms 操作页面
      await fillPwd(); // fillPwd 操作页面

      if (config.autoConfirm) {
        try {
          const confirmButtonSelector = 'button.mhs-button--primary:not([disabled])'; // 页面元素
          Logger.log(`等待确认按钮: "${confirmButtonSelector}"`);
          const potentialConfirmButton = await waitFor(confirmButtonSelector, 5000); // waitFor 操作页面

          const buttonText = potentialConfirmButton.textContent || "";
          Logger.log(`找到候选确认按钮，文本: "${buttonText.trim()}"`);

          if (!buttonText.includes('去充值')) {
            Logger.log('按钮非"去充值", 点击确认购买。');
            potentialConfirmButton.click();
            toast('已自动确认购买', 'success');
            Logger.log('已自动确认购买。');
          } else {
            toast('检测到"去充值"按钮，而非实际确认购买按钮。购买未自动确认。', 'warning');
            Logger.log('自动确认：实际找到的是"去充值"按钮。');
          }
        } catch (err) {
          toast(`自动确认购买失败: ${err.message || '未知错误'}`, 'warning');
          Logger.log(`自动确认购买环节出错: ${err.message || err}`);
        }
      } else {
        toast('已点击购买，请手动确认或取消支付', 'info');
      }
    } catch (error) {
      Logger.log(`购买流程主逻辑出错: ${error.message || error}`);
      toast(`购买流程遇到错误: ${error.message || '未知错误'}`, 'error');
    } finally {
      isBuying = false;
      Logger.log('退出购买流程 (isBuying = false)');
    }
  };

  /* ─────────── 控制面板 ─────────── */
  function addPanel() {
    if (!shadowRoot) {
      console.error("[MHS AutoBuy] Shadow DOM for Panel not ready.");
      return;
    }
    const panelId = 'mhs_control_panel_shadow'; // 在Shadow DOM内部使用的ID
    S_ID(panelId)?.remove(); // 如果已存在，先移除

    const p = document.createElement('div');
    p.id = panelId;
    Object.assign(p.style, {
      position: 'fixed', top: '50%', right: '0px', transform: 'translateY(-50%)',
      width: '320px',
      background: '#fff', boxShadow: '0 0 15px rgba(0,0,0,.15)',
      borderRadius: '8px 0 0 8px', padding: '20px',
      maxHeight: 'calc(100vh - 40px)', overflowY: 'auto', zIndex: 9999,
      border: '1px solid #e0e0e0',
      // fontFamily 已在 :host 设置，这里不需要重复
    });

    const styleBtn = (b, bg, fg = '#fff', cur = true) => Object.assign(b.style, {
      padding: '10px 18px', background: bg, color: fg,
      border: 'none', borderRadius: '6px', cursor: cur ? 'pointer' : 'default',
      display: 'block', marginBottom: '12px', width: '100%', textAlign: 'center',
      fontSize: '14px', fontWeight: '500', transition: 'background-color 0.2s ease'
    });

    const mkBtn = (txt, bg, fn, fg = '#fff') => {
      const b = document.createElement('button');
      b.textContent = txt;
      styleBtn(b, bg, fg);
      b.onclick = fn;
      b.onmouseenter = () => { if (b.style.cursor === 'pointer') b.style.filter = 'brightness(1.1)'; };
      b.onmouseleave = () => { b.style.filter = 'brightness(1)'; };
      return b;
    };

    const mkTog = (getter, setter, lbl) => {
      const b = document.createElement('button');
      b.dataset.label = lbl;

      b.sync = () => {
        const on = getter();
        b.textContent = `${lbl}: ${on ? '开启' : '关闭'}`;
        styleBtn(b, on ? '#4caf50' : '#f44336');
      };

      b.onclick = () => {
        const newState = !getter();
        setter(newState);
        saveCfg();
        b.sync();
        toast(`${lbl} ${newState ? '已开启' : '已关闭'}`, 'info');
        if (lbl === '自动刷新') {
            const countdownEl = S_ID('refresh-countdown'); // 从Shadow DOM获取
            if (newState) {
                if (countdownEl) countdownEl.style.display = 'block';
                startRefresh(); // startRefresh 内部已适配
            } else {
                clearTimeout(window._autoRf);
                clearInterval(window._cd);
                if (countdownEl) {
                    countdownEl.style.display = 'none';
                }
            }
        }
      };
      b.sync();
      return b;
    };

    const bar = (id, bg, col, txt) => { // id 是在Shadow DOM内使用的短id
      const d = document.createElement('div');
      d.id = id; // 这个ID将在S_ID(id)时被使用
      Object.assign(d.style, {
        padding: '10px 15px', background: bg, color: col, borderRadius: '6px',
        marginBottom: '12px', width: '100%', textAlign: 'center', fontWeight: 'bold',
        fontSize: '13px', border: `1px solid ${col === '#333' ? '#ccc' : 'transparent'}`
      });
      d.textContent = txt;
      return d;
    };

    /* 控制按钮 */
    const testBuy = mkBtn('测试购买流程', '#1e88e5', async () => {
        if (isBuying) {
            toast('购买流程已在进行中，请稍候。', 'warning');
            return;
        }
        await buyFlow();
    });
    const autoBuyTog = mkTog(() => config.autoBuy, v => (config.autoBuy = v), '自动模式');
    const stockTog = mkTog(() => config.enableStockCheck, v => (config.enableStockCheck = v), '库存检测');
    const refreshTog = mkTog(() => config.enableAutoRefresh, v => {config.enableAutoRefresh = v; }, '自动刷新');
    const confirmTog = mkTog(() => config.autoConfirm, v => (config.autoConfirm = v), '自动确认');

    const pwdBtn = mkBtn('设置支付密码', '#ff9800', () => {
      const pw = prompt('请输入支付密码(仅本地保存):', config.payPassword || '');
      if (pw !== null) {
        config.payPassword = pw;
        config.autoInputPassword = !!pw;
        saveCfg();
        toast(pw ? '支付密码已设置' : '支付密码已清除', 'success');
      }
    });
    const logTog = mkTog(() => config.showDebugLogs, () => Logger.toggle(), '调试日志');
    const logClr = mkBtn('清除调试日志', '#9e9e9e', () => { Logger.clear(); toast('已清除调试日志', 'success'); });

    const chkNow = mkBtn('立即检测库存', '#2196f3', () => {
      const isStockAvailable = updateStockBar(); // updateStockBar 已适配
      toast(`手动检测: ${isStockAvailable ? '有货' : '无货'}`, isStockAvailable ? 'success' : 'warning');
    });
    const rfNow = mkBtn('立即刷新页面', '#00bcd4', () => {
      toast('即将刷新页面...', 'info');
      if (config.saveStateBeforeRefresh) saveCfg();
      setTimeout(() => location.reload(), 300);
    });

    /* 刷新间隔 */
    const lbl = document.createElement('div');
    lbl.textContent = '刷新间隔(秒):';
    lbl.style.cssText = 'margin:15px 0 8px;font-weight:bold;font-size:14px;color:#333;'; // 颜色会继承自:host或通用设置
    const inp = document.createElement('input');
    Object.assign(inp, { type: 'number', min: 3, max: 3600, value: config.autoRefreshInterval / 1000 });
    inp.style.cssText = 'width:100%;padding:8px 10px;margin-bottom:15px;box-sizing:border-box;border:1px solid #ccc;border-radius:4px;font-size:14px;color:#333;background:#fff;'; // 明确背景和文字色
    inp.onchange = () => {
      let v = parseInt(inp.value);
      if (isNaN(v)) v = config.autoRefreshInterval / 1000;
      v = Math.max(3, Math.min(3600, v));

      config.autoRefreshInterval = v * 1000;
      inp.value = v;
      saveCfg();
      toast(`刷新间隔已设为 ${v} 秒`, 'success');
      if (config.enableAutoRefresh) {
        startRefresh(); // 已适配
      }
    };

    const title = document.createElement('h3');
    title.textContent = '米画师助手';
    title.style.cssText = 'text-align:center; margin-top:0; margin-bottom:20px; font-size:18px; color:#333;'; // 颜色

    /* 装载到面板p */
    p.appendChild(title);
    [ bar('stock-status', '#e0e0e0', '#333', '正在检测库存...'),
      bar('refresh-countdown', '#e1f5fe', '#0277bd', '刷新倒计时: 计算中...'),
      testBuy, autoBuyTog, stockTog, refreshTog, confirmTog,
      lbl, inp, chkNow, rfNow, pwdBtn, logTog, logClr
    ].forEach(el => p.appendChild(el));

    if (Logger.el) {
        p.appendChild(Logger.el); // Logger.el的样式已在Logger.init中调整为适合嵌入
    }

    shadowRoot.appendChild(p);

    updateStockBar();

    const countdownEl = S_ID('refresh-countdown');
    if (countdownEl) {
        countdownEl.style.display = config.enableAutoRefresh ? 'block' : 'none';
    }
  }

  /* ─────────── 初始化 ─────────── */
  try {
    const storedConfig = JSON.parse(localStorage.getItem('mihuashi_auto_buy') || '{}');
    for (const key in config) {
        if (storedConfig.hasOwnProperty(key) && storedConfig[key] !== undefined) {
            config[key] = storedConfig[key];
        }
    }
  } catch (e) {
    console.error('加载localStorage配置错误:', e);
  }

  initializeScriptUIHost(); // 1. 初始化UI宿主和Shadow DOM
  Logger.init();          // 2. Logger准备好它的UI元素 (但未附加)
  initToastContainer();   // 3. Toast容器初始化 (在主DOM，ID随机)
  addPanel();             // 4. 创建面板并将其内容（包括日志元素）放入Shadow DOM

  if (config.enableAutoRefresh) {
    startRefresh();
  } else {
    const countdownEl = S_ID('refresh-countdown');
    if (countdownEl) countdownEl.style.display = 'none';
  }

  setTimeout(() => {
    updateStockBar();
    if (config.autoBuy && !isBuying && (!config.enableStockCheck || hasStock())) {
      Logger.log('初始化:自动购买条件满足，尝试执行购买流程。');
      buyFlow();
    } else if (config.autoBuy) {
        Logger.log(`初始化:未执行自动购买。isBuying: ${isBuying}, stockCheck: ${config.enableStockCheck}, hasStock: ${config.enableStockCheck ? hasStock() : 'N/A (库存检测关闭)'}`);
    }
  }, config.buyDelay);

  Logger.log('米画师自动购买脚本 (Stealth Edition) 已加载完成。');
})();
