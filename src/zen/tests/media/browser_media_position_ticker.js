/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function test_one_ticker_updates_only_visible_cards() {
  gZenMediaController.closeAllCards();

  const originalTab = gBrowser.selectedTab;
  const tabA = await addMediaTab();
  const tabB = await addMediaTab();

  try {
    await BrowserTestUtils.switchTab(gBrowser, tabA);
    await setMediaSessionMetadata(tabA, { title: "Ticker A", artist: "A" });
    await playVideoIn(tabA);

    await BrowserTestUtils.switchTab(gBrowser, tabB);
    await setMediaSessionMetadata(tabB, { title: "Ticker B", artist: "B" });
    await playVideoIn(tabB);

    await BrowserTestUtils.switchTab(gBrowser, originalTab);
    await waitForMediaBarVisible();
    await BrowserTestUtils.waitForCondition(
      () => visibleMediaCards().length === 2,
      "both media cards become visible"
    );
    await BrowserTestUtils.waitForCondition(
      () => gZenMediaController.positionTickerCount === 1,
      "one window position ticker starts for both cards"
    );

    const cardB = frontMediaCard();
    cardB.updatePositionState({
      position: 40,
      duration: 300,
      playbackRate: 1,
    });
    const currentTime = cardB.element.querySelector(".zen-media-current-time");

    await BrowserTestUtils.switchTab(gBrowser, tabB);
    await BrowserTestUtils.waitForCondition(
      () => cardB.element.hidden,
      "selected tab's media card becomes hidden"
    );
    const hiddenText = currentTime.textContent;

    await new Promise(resolve => setTimeout(resolve, 1200));
    Assert.equal(
      currentTime.textContent,
      hiddenText,
      "hidden card receives no ticker DOM updates"
    );
    Assert.equal(
      gZenMediaController.positionTickerCount,
      1,
      "remaining visible card keeps same single window ticker"
    );

    await BrowserTestUtils.switchTab(gBrowser, originalTab);
    await BrowserTestUtils.waitForCondition(
      () => !cardB.element.hidden,
      "media card becomes visible again"
    );
    await BrowserTestUtils.waitForCondition(
      () => currentTime.textContent !== hiddenText,
      "shown card derives current position from monotonic elapsed time"
    );
  } finally {
    await pauseVideoIn(tabA);
    await pauseVideoIn(tabB);
    BrowserTestUtils.removeTab(tabA);
    BrowserTestUtils.removeTab(tabB);
    gBrowser.selectedTab = originalTab;
    gZenMediaController.closeAllCards();
    await BrowserTestUtils.waitForCondition(
      () => gZenMediaController.positionTickerCount === 0,
      "window ticker stops after all cards close"
    );
  }
});

add_task(async function test_ticker_follows_window_activity() {
  gZenMediaController.closeAllCards();

  const originalTab = gBrowser.selectedTab;
  const mediaTab = await addMediaTab();
  const originalOcclusion = Object.getOwnPropertyDescriptor(
    window,
    "isFullyOccluded"
  );

  registerCleanupFunction(() => {
    if (originalOcclusion) {
      Object.defineProperty(window, "isFullyOccluded", originalOcclusion);
    } else {
      delete window.isFullyOccluded;
    }
    window.dispatchEvent(new CustomEvent("occlusionstatechange"));
  });

  try {
    await BrowserTestUtils.switchTab(gBrowser, mediaTab);
    await playVideoIn(mediaTab);
    await BrowserTestUtils.switchTab(gBrowser, originalTab);
    await waitForMediaBarVisible();
    await BrowserTestUtils.waitForCondition(
      () => gZenMediaController.positionTickerCount === 1,
      "visible media starts window ticker"
    );

    Object.defineProperty(window, "isFullyOccluded", {
      configurable: true,
      get: () => true,
    });
    window.dispatchEvent(new CustomEvent("occlusionstatechange"));
    await BrowserTestUtils.waitForCondition(
      () => gZenMediaController.positionTickerCount === 0,
      "occluded window parks media ticker"
    );

    Object.defineProperty(window, "isFullyOccluded", {
      configurable: true,
      get: () => false,
    });
    window.dispatchEvent(new CustomEvent("occlusionstatechange"));
    await BrowserTestUtils.waitForCondition(
      () => gZenMediaController.positionTickerCount === 1,
      "visible window resumes same media ticker"
    );
  } finally {
    if (originalOcclusion) {
      Object.defineProperty(window, "isFullyOccluded", originalOcclusion);
    } else {
      delete window.isFullyOccluded;
    }
    window.dispatchEvent(new CustomEvent("occlusionstatechange"));
    await pauseVideoIn(mediaTab);
    BrowserTestUtils.removeTab(mediaTab);
    gBrowser.selectedTab = originalTab;
    gZenMediaController.closeAllCards();
  }
});
