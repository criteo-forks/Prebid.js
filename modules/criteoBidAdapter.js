import { loadExternalScript } from '../src/adloader';
import { registerBidder } from '../src/adapters/bidderFactory';
import { parse } from '../src/url';
import * as utils from '../src/utils';
import find from 'core-js/library/fn/array/find';
import { ajax } from '../src/ajax';
import Promise from 'promise-polyfill';

export const ADAPTER_VERSION = 18;
const BIDDER_CODE = 'criteo';
const CDB_ENDPOINT = '//bidder.criteo.com/cdb';
const CRITEO_VENDOR_ID = 91;
const INTEGRATION_MODES = {
  'amp': 1,
};
const PROFILE_ID_INLINE = 207;
export const PROFILE_ID_PUBLISHERTAG = 185;

// Unminified source code can be found in: https://github.com/Prebid-org/prebid-js-external-js-criteo/blob/master/dist/prod.js
const PUBLISHER_TAG_URL = '//static.criteo.net/js/ld/publishertag.prebid.js';

export const FAST_BID_PUBKEY_IE11 = {
  kty: 'RSA',
  n: 'ztQYwCE5BU7T9CDM5he6rKoabstXRmkzx54zFPZkWbK530dwtLBDeaWBMxHBUT55CYyboR_EZ4efghPi3CoNGfGWezpjko9P6p2EwGArtHEeS4slhu_SpSIFMjG6fdrpRoNuIAMhq1Z-Pr_-HOd1pThFKeGFr2_NhtAg-TXAzaU',
  e: 'AQAB',
  alg: 'RS256'
};

export const FAST_BID_PUBKEY = Object.assign({}, FAST_BID_PUBKEY_IE11, { ext: 'true' });

/** @type {BidderSpec} */
export const spec = {
  code: BIDDER_CODE,

  /**
   * @param {object} bid
   * @return {boolean}
   */
  isBidRequestValid: bid => (
    !!(bid && bid.params && (bid.params.zoneId || bid.params.networkId))
  ),

  /**
   * @param {BidRequest[]} bidRequests
   * @param {*} bidderRequest
   * @return {ServerRequest}
   */
  buildRequests: (bidRequests, bidderRequest) => {
    let loadFastBidPromise = new Promise((resolve, reject) => resolve(false));
    let callCdbPromise = new Promise((resolve, reject) => resolve({}));

    // If publisher tag not already loaded try to get it from fast bid
    if (!publisherTagAvailable()) {
      window.Criteo = window.Criteo || {};
      window.Criteo.usePrebidEvents = false;

      loadFastBidPromise = tryGetCriteoFastBid() || loadFastBidPromise;

      // Reload the PublisherTag after the timeout to ensure FastBid is up-to-date and tracking done properly
      setTimeout(() => {
        loadExternalScript(PUBLISHER_TAG_URL, BIDDER_CODE);
      }, bidderRequest.timeout);
    } else {
      let cdbRequest = buildRequest(bidRequests, bidderRequest);
      return { method: 'POST', url: cdbRequest.url, data: cdbRequest.data, bidRequests };
    }

    callCdbPromise = loadFastBidPromise
      .then(_ => {
        let cdbRequest = buildRequest(bidRequests, bidderRequest);

        return new Promise(function (resolve, reject) {
          ajax(
            cdbRequest.url,
            {
              success: function(responseText, _) {
                try {
                  resolve(JSON.parse(responseText));
                } catch (e) {
                  // Doesn't matter if not response
                  resolve();
                }
              },
              error: function(statusText, _) {
                reject(new Error(statusText));
              }
            },
            JSON.stringify(cdbRequest.data),
            {
              method: 'POST',
              contentType: 'text/plain',
              withCredentials: true
            }
          );
        });
      })
      .catch(error => {
        console.error('Unable to call criteo, error is', error);
      })
      .then(response => {
        return response;
      });

    return { method: 'PROMISE', promise: callCdbPromise, bidRequests };
  },

  /**
   * @param {*} response
   * @param {ServerRequest} request
   * @return {Bid[]}
   */
  interpretResponse: (response, request) => {
    const body = response !== undefined ? (response.body || response) : undefined;

    if (publisherTagAvailable()) {
      const adapter = Criteo.PubTag.Adapters.Prebid.GetAdapter(request);
      if (adapter) {
        return adapter.interpretResponse(body, request);
      }
    }

    const bids = [];

    if (body && body.slots && utils.isArray(body.slots)) {
      body.slots.forEach(slot => {
        const bidRequest = find(request.bidRequests, b => b.adUnitCode === slot.impid && (!b.params.zoneId || parseInt(b.params.zoneId) === slot.zoneid));
        const bidId = bidRequest.bidId;
        const bid = {
          requestId: bidId,
          adId: slot.bidId || utils.getUniqueIdentifierStr(),
          cpm: slot.cpm,
          currency: slot.currency,
          netRevenue: true,
          ttl: slot.ttl || 60,
          creativeId: bidId,
          width: slot.width,
          height: slot.height,
        }
        if (slot.native) {
          bid.ad = createNativeAd(bidId, slot.native, bidRequest.params.nativeCallback);
        } else {
          bid.ad = slot.creative;
        }
        bids.push(bid);
      });
    }

    return bids;
  },

  /**
   * @param {TimedOutBid} timeoutData
   */
  onTimeout: (timeoutData) => {
    if (publisherTagAvailable()) {
      const adapter = Criteo.PubTag.Adapters.Prebid.GetAdapter(timeoutData.auctionId);
      adapter.handleBidTimeout();
    }
  },

  /**
   * @param {Bid} bid
   */
  onBidWon: (bid) => {
    if (publisherTagAvailable()) {
      const adapter = Criteo.PubTag.Adapters.Prebid.GetAdapter(bid.auctionId);
      adapter.handleBidWon(bid);
    }
  },

  /**
   * @param {Bid} bid
   */
  onSetTargeting: (bid) => {
    if (publisherTagAvailable()) {
      const adapter = Criteo.PubTag.Adapters.Prebid.GetAdapter(bid.auctionId);
      adapter.handleSetTargeting(bid);
    }
  },
};

/**
 * @return {boolean}
 */
function publisherTagAvailable() {
  return typeof Criteo !== 'undefined' && Criteo.PubTag && Criteo.PubTag.Adapters && Criteo.PubTag.Adapters.Prebid;
}

/**
 * @param {BidRequest[]} bidRequests
 * @return {CriteoContext}
 */
function buildContext(bidRequests) {
  const url = utils.getTopWindowUrl();
  const queryString = parse(url).search;

  const context = {
    url: url,
    debug: queryString['pbt_debug'] === '1',
    noLog: queryString['pbt_nolog'] === '1',
    integrationMode: undefined,
  };

  bidRequests.forEach(bidRequest => {
    if (bidRequest.params.integrationMode) {
      context.integrationMode = bidRequest.params.integrationMode;
    }
  })

  return context;
}

/**
 * @param {CriteoContext} context
 * @return {string}
 */
function buildCdbUrl(context) {
  let url = CDB_ENDPOINT;
  url += '?profileId=' + PROFILE_ID_INLINE;
  url += '&av=' + String(ADAPTER_VERSION);
  url += '&wv=' + encodeURIComponent('$prebid.version$');
  url += '&cb=' + String(Math.floor(Math.random() * 99999999999));

  if (context.integrationMode in INTEGRATION_MODES) {
    url += '&im=' + INTEGRATION_MODES[context.integrationMode];
  }
  if (context.debug) {
    url += '&debug=1';
  }
  if (context.noLog) {
    url += '&nolog=1';
  }

  return url;
}

function buildRequest(bidRequests, bidderRequest) {
  let url;
  let data;
  if (publisherTagAvailable()) {
    const adapter = new Criteo.PubTag.Adapters.Prebid(PROFILE_ID_PUBLISHERTAG, ADAPTER_VERSION, bidRequests, bidderRequest, '$prebid.version$');
    url = adapter.buildCdbUrl();
    data = adapter.buildCdbRequest();
  } else {
    const context = buildContext(bidRequests);
    url = buildCdbUrl(context);
    data = buildCdbRequest(context, bidRequests, bidderRequest);
  }
  return { url, data };
}

/**
 * @param {CriteoContext} context
 * @param {BidRequest[]} bidRequests
 * @return {*}
 */
function buildCdbRequest(context, bidRequests, bidderRequest) {
  let networkId;
  const request = {
    publisher: {
      url: context.url,
    },
    slots: bidRequests.map(bidRequest => {
      networkId = bidRequest.params.networkId || networkId;
      const slot = {
        impid: bidRequest.adUnitCode,
        transactionid: bidRequest.transactionId,
        auctionId: bidRequest.auctionId,
        sizes: bidRequest.sizes.map(size => size[0] + 'x' + size[1]),
      };
      if (bidRequest.params.zoneId) {
        slot.zoneid = bidRequest.params.zoneId;
      }
      if (bidRequest.params.publisherSubId) {
        slot.publishersubid = bidRequest.params.publisherSubId;
      }
      if (bidRequest.params.nativeCallback) {
        slot.native = true;
      }
      return slot;
    }),
  };
  if (networkId) {
    request.publisher.networkid = networkId;
  }
  if (bidderRequest && bidderRequest.gdprConsent) {
    request.gdprConsent = {};
    if (typeof bidderRequest.gdprConsent.gdprApplies !== 'undefined') {
      request.gdprConsent.gdprApplies = !!(bidderRequest.gdprConsent.gdprApplies);
    }
    if (bidderRequest.gdprConsent.vendorData && bidderRequest.gdprConsent.vendorData.vendorConsents &&
      typeof bidderRequest.gdprConsent.vendorData.vendorConsents[ CRITEO_VENDOR_ID.toString(10) ] !== 'undefined') {
      request.gdprConsent.consentGiven = !!(bidderRequest.gdprConsent.vendorData.vendorConsents[ CRITEO_VENDOR_ID.toString(10) ]);
    }
    if (typeof bidderRequest.gdprConsent.consentString !== 'undefined') {
      request.gdprConsent.consentData = bidderRequest.gdprConsent.consentString;
    }
  }
  return request;
}

/**
 * @param {string} id
 * @param {*} payload
 * @param {*} callback
 * @return {string}
 */
function createNativeAd(id, payload, callback) {
  // Store the callback and payload in a global object to be later accessed from the creative
  window.criteo_prebid_native_slots = window.criteo_prebid_native_slots || {};
  window.criteo_prebid_native_slots[id] = { callback, payload };

  // The creative is in an iframe so we have to get the callback and payload
  // from the parent window (doesn't work with safeframes)
  return `<script type="text/javascript">
    var win = window;
    for (var i = 0; i < 10; ++i) {
      win = win.parent;
      if (win.criteo_prebid_native_slots) {
        var responseSlot = win.criteo_prebid_native_slots["${id}"];
        responseSlot.callback(responseSlot.payload);
        break;
      }
    }
  </script>`;
}

export function str2ab(str) {
  var buf = new ArrayBuffer(str.length);
  var bufView = new Uint8Array(buf);
  for (var i = 0; i < str.length; ++i) {
    bufView[i] = str.charCodeAt(i);
  }
  return buf;
}

/**
 * Verify fastBid with cryto.subtle
 * @param {string} hash
 * @param {string} code
 * @returns Promise<boolean> if fastbid is valid
 */
function cryptoVerifyAsync(hash, code) {
  // Standard
  var standardSubtle = window.crypto && (window.crypto.subtle || window.crypto.webkitSubtle);
  var algo = { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } };
  if (standardSubtle) {
    return standardSubtle.importKey('jwk', FAST_BID_PUBKEY, algo, false, ['verify']).then(
      function (cryptoKey) {
        return standardSubtle.verify(algo, cryptoKey, str2ab(atob(hash)), str2ab(code));
      }
    );
  }

  // IE11
  if (window.msCrypto) {
    return new Promise(function (resolve, reject) {
      try {
        var eImport = window.msCrypto.subtle.importKey('jwk', str2ab(JSON.stringify(FAST_BID_PUBKEY_IE11)), algo, false, ['verify']);
        eImport.onerror = function (evt) { reject(evt) };
        eImport.oncomplete = function (evtKey) {
          var cryptoKey = evtKey.target.result;
          var eVerify = window.msCrypto.subtle.verify(algo, cryptoKey, str2ab(atob(hash)), str2ab(code));
          eVerify.onerror = function (evt) { reject(evt); };
          eVerify.oncomplete = function (evt) { resolve(evt.target.result); };
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  // cypto not available, return undefined
}

/**
 * check if fastbid is valid
 * @param {string} fastBid
 * @returns {Promise<boolean>} if fastBid is valid, undefined if error
 */
function validateFastBid(fastBid) {
  // The value stored must contain the file's encrypted hash as first line
  const firstLineEnd = fastBid.indexOf('\n');
  const firstLine = fastBid.substr(0, firstLineEnd).trim();
  if (firstLine.substr(0, 9) !== '// Hash: ') {
    utils.logWarn('No hash found in FastBid');
    return undefined;
  }

  // Remove the hash part from the locally stored value
  const fileEncryptedHash = firstLine.substr(9);
  const publisherTag = fastBid.substr(firstLineEnd + 1);

  // Verify the hash using cryptography
  try {
    return cryptoVerifyAsync(fileEncryptedHash, publisherTag);
  } catch (e) {
    utils.logWarn('Failed to verify Criteo FastBid');
    return undefined;
  }
}

/**
 * @return {Promise<boolean>}
 */
export function tryGetCriteoFastBid() {
  try {
    const fastBid = localStorage.getItem('criteo_fast_bid');
    if (fastBid !== null) {
      const p = validateFastBid(fastBid);
      if (p !== undefined) {
        return p.then((isValid) => {
          // check if fastBid is valid
          utils.logInfo('FastBid is Valid');
          eval(fastBid); // eslint-disable-line no-eval
          return isValid;
        }).catch(error => {
          utils.logWarn('catch validateFastBid error is', error);
        });
      }
    }
  } catch (e) {
    // Unable to get fast bid
  }
}

registerBidder(spec);
