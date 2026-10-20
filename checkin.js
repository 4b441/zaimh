const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1280,800'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // 监听网络响应，抓取签到接口的实际返回值
    page.on('response', async (res) => {
      const url = res.url();
      if (url.includes('sign') || url.includes('checkin') || url.includes('score') || url.includes('point')) {
        try {
          const body = await res.text();
          console.log(`[接口响应] ${url} ->`, body.slice(0, 200));
        } catch (e) {}
      }
    });

    console.log('1. 正在访问再漫画个人中心...');
    await page.goto('https://i.zaimanhua.com/', { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 3000));

    const username = process.env.USERNAME;
    const password = process.env.PASSWORD;

    // 检查是否有登录输入框
    const userInput = await page.$('input[placeholder*="账号"], input[placeholder*="手机"], input[type="text"]');
    if (userInput) {
      console.log('2. 处于登录页面，切换到账号密码登录...');
      await page.evaluate(() => {
        const tabs = Array.from(document.querySelectorAll('div, span, a, button, li, p'));
        const pwdTab = tabs.find(el => el.textContent.trim() === '账号密码登录');
        if (pwdTab) pwdTab.click();
      });
      await new Promise(r => setTimeout(r, 1000));

      const accountField = await page.$('input[placeholder*="账号"], input[placeholder*="手机"], input[type="text"]');
      if (accountField) {
        await accountField.click({ clickCount: 3 });
        await accountField.type(username, { delay: 60 });
      }

      const pwdField = await page.$('input[type="password"], input[placeholder*="密码"]');
      if (pwdField) {
        await pwdField.click({ clickCount: 3 });
        await pwdField.type(password, { delay: 60 });
        await pwdField.press('Enter');
      }

      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, .login-btn, input[type="submit"], div, a'));
        const submitBtn = btns.find(el => {
          const text = (el.textContent.trim() || el.value || '');
          const isNav = el.closest('header, nav, .header, .nav, .top-bar');
          return (text === '登录') && !isNav && (el.tagName === 'BUTTON' || el.classList.contains('btn') || el.type === 'submit' || el.classList.contains('login-btn'));
        });
        if (submitBtn) submitBtn.click();
      });

      console.log('3. 等待跳转与个人中心加载...');
      await new Promise(r => setTimeout(r, 6000));
    }

    console.log('当前页面 URL:', page.url());

    // 4. 定位签到按钮的真实 DOM 句柄（ElementHandle）
    console.log('4. 正在检索签到按钮句柄...');
    const btnHandle = await page.evaluateHandle(() => {
      const elements = Array.from(document.querySelectorAll('button, a, span, div, p'));
      return elements.find(el => {
        const text = el.textContent.trim();
        return (text === '立即签到' || text === '每日签到' || text === '签到') && !text.includes('已签到');
      });
    });

    const isAlready = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('*')).some(el => el.textContent.trim().includes('已签到'));
    });

    if (isAlready) {
      console.log('>>> [验证通过] 页面已处于“已签到”状态，无需重复打卡！');
      return;
    }

    const signElement = btnHandle.asElement();
    if (!signElement) {
      const bodySnippet = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 200));
      throw new Error(`未找到可签到按钮，当前页面文本：${bodySnippet}`);
    }

    // 5. 使用真实的物理鼠标进行点击（带有操作系统层面的坐标事件，isTrusted = true）
    console.log('5. 使用真实物理鼠标点击签到按钮...');
    await signElement.scrollIntoViewIfNeeded();
    await new Promise(r => setTimeout(r, 800));
    await signElement.click();

    // 6. 严格反查：循环轮询 6 秒，确认页面是否确实变更为“已签到”
    console.log('6. 等待并验证签到结果...');
    let verified = false;
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const hasChanged = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('*')).some(el => el.textContent.trim().includes('已签到'));
      });
      if (hasChanged) {
        verified = true;
        break;
      }
    }

    if (verified) {
      console.log('>>> [成功] 页面已变为“已签到”，今日打卡成功入账！');
    } else {
      throw new Error('点击后页面未能在 6 秒内变更为“已签到”，签到请求可能被服务端拒绝或拦截。');
    }
  } catch (err) {
    console.error('执行失败：', err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
