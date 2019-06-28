import { expect } from 'chai';
import { tryGetCriteoFastBid, str2ab, spec, FAST_BID_PUBKEY, PROFILE_ID_PUBLISHERTAG, ADAPTER_VERSION } from 'modules/criteoBidAdapter';
import { createBid } from 'src/bidfactory';
import CONSTANTS from 'src/constants.json';
import * as utils from 'src/utils';

describe('The Criteo bidding adapter', function () {
  let xhr;
  let requests;
  let propertiesToRestore;
  let localStorageMock;
  let consoleMock;

  // sinon version installed by dev-deps doesn't support the replaceGetter for objects like window
  // and upgrading to the latest sinon generates a tons of warning accross all modules
  function replaceWindowProperty(propertyName, replacement) {
    let tmpObject = {}
    tmpObject[propertyName] = window[propertyName];
    propertiesToRestore = { ...propertiesToRestore, ...tmpObject };

    Object.defineProperty(window, propertyName, {
      get: function () { return replacement; },
      configurable: true
    });
  }

  beforeEach(function () {
    global.Criteo = undefined;
    localStorageMock = sinon.mock(localStorage);
    consoleMock = sinon.mock(console);
    propertiesToRestore = {};

    // Setup Fake XHR to auto respond a 204 from CDB
    xhr = sinon.useFakeXMLHttpRequest();
    requests = [];
    xhr.onCreate = request => {
      requests.push(request);

      request.onSend = () => {
        request.respond(204, {}, '');
      };
    };
  });

  afterEach(function() {
    xhr.restore();
    localStorageMock.restore();
    consoleMock.restore();
    for (let property in propertiesToRestore) {
      if (propertiesToRestore.hasOwnProperty(property)) {
        Object.defineProperty(window, property, {
          get: function () { return propertiesToRestore[property]; }
        });
      }
    }
  });

  describe('isBidRequestValid', function () {
    it('should return false when given an invalid bid', function () {
      const bid = {
        bidder: 'criteo',
      };
      const isValid = spec.isBidRequestValid(bid);
      expect(isValid).to.equal(false);
    });

    it('should return true when given a zoneId bid', function () {
      const bid = {
        bidder: 'criteo',
        params: {
          zoneId: 123,
        },
      };
      const isValid = spec.isBidRequestValid(bid);
      expect(isValid).to.equal(true);
    });

    it('should return true when given a networkId bid', function () {
      const bid = {
        bidder: 'criteo',
        params: {
          networkId: 456,
        },
      };
      const isValid = spec.isBidRequestValid(bid);
      expect(isValid).to.equal(true);
    });

    it('should return true when given a mixed bid with both a zoneId and a networkId', function () {
      const bid = {
        bidder: 'criteo',
        params: {
          zoneId: 123,
          networkId: 456,
        },
      };
      const isValid = spec.isBidRequestValid(bid);
      expect(isValid).to.equal(true);
    });
  });

  describe('buildRequests', function () {
    const bidderRequest = { timeout: 3000,
      gdprConsent: {
        gdprApplies: 1,
        consentString: 'concentDataString',
        vendorData: {
          vendorConsents: {
            '91': 1
          },
        },
      },
    };

    it('should catch and log into console when xhr failed', () => {
      const bidRequests = [
        {
          bidder: 'criteo',
          adUnitCode: 'bid-123',
          transactionId: 'transaction-123',
          sizes: [[728, 90]],
          params: {
            zoneId: 123,
          },
        },
      ];

      xhr.onCreate = request => {
        request.onSend = () => {
          request.respond(404, {}, '');
        };
      };

      consoleMock.expects('error').withExactArgs('Unable to call criteo, error is', sinon.match.any).once();

      return spec.buildRequests(bidRequests, bidderRequest).promise.then(result => {
        expect(result).to.be.undefined;
        consoleMock.verify();
      });
    });

    it('should properly build a zoneId request', () => {
      const bidRequests = [
        {
          bidder: 'criteo',
          adUnitCode: 'bid-123',
          transactionId: 'transaction-123',
          sizes: [[728, 90]],
          params: {
            zoneId: 123,
            publisherSubId: '123',
            nativeCallback: function() {}
          },
        },
      ];

      return spec.buildRequests(bidRequests, bidderRequest).promise.then(_ => {
        expect(requests).to.have.length(1);
        const request = requests[0];
        expect(request.url).to.match(/^\/\/bidder\.criteo\.com\/cdb\?profileId=207&av=\d+&wv=[^&]+&cb=\d/);
        expect(request.method).to.equal('POST');
        const ortbRequest = JSON.parse(request.requestBody);
        expect(ortbRequest.publisher.url).to.equal(utils.getTopWindowUrl());
        expect(ortbRequest.slots).to.have.lengthOf(1);
        expect(ortbRequest.slots[0].impid).to.equal('bid-123');
        expect(ortbRequest.slots[0].publishersubid).to.equal('123');
        expect(ortbRequest.slots[0].native).to.equal(true);
        expect(ortbRequest.slots[0].transactionid).to.equal('transaction-123');
        expect(ortbRequest.slots[0].sizes).to.have.lengthOf(1);
        expect(ortbRequest.slots[0].sizes[0]).to.equal('728x90');
        expect(ortbRequest.slots[0].zoneid).to.equal(123);
        expect(ortbRequest.gdprConsent.consentData).to.equal('concentDataString');
        expect(ortbRequest.gdprConsent.gdprApplies).to.equal(true);
        expect(ortbRequest.gdprConsent.consentGiven).to.equal(true);
      });
    });

    it('should properly build a networkId request', () => {
      const bidderRequest = {
        timeout: 3000,
        gdprConsent: {
          gdprApplies: 0,
          consentString: undefined,
          vendorData: {
            vendorConsents: {
              '1': 0
            },
          },
        },
      };
      const bidRequests = [
        {
          bidder: 'criteo',
          adUnitCode: 'bid-123',
          transactionId: 'transaction-123',
          sizes: [[300, 250], [728, 90]],
          params: {
            networkId: 456,
          },
        },
      ];

      return spec.buildRequests(bidRequests, bidderRequest).promise.then(_ => {
        expect(requests).to.have.length(1);
        const request = requests[0];
        expect(request.url).to.match(/^\/\/bidder\.criteo\.com\/cdb\?profileId=207&av=\d+&wv=[^&]+&cb=\d/);
        expect(request.method).to.equal('POST');
        const ortbRequest = JSON.parse(request.requestBody);
        expect(ortbRequest.publisher.url).to.equal(utils.getTopWindowUrl());
        expect(ortbRequest.publisher.networkid).to.equal(456);
        expect(ortbRequest.slots).to.have.lengthOf(1);
        expect(ortbRequest.slots[0].impid).to.equal('bid-123');
        expect(ortbRequest.slots[0].transactionid).to.equal('transaction-123');
        expect(ortbRequest.slots[0].sizes).to.have.lengthOf(2);
        expect(ortbRequest.slots[0].sizes[0]).to.equal('300x250');
        expect(ortbRequest.slots[0].sizes[1]).to.equal('728x90');
        expect(ortbRequest.gdprConsent.consentData).to.equal(undefined);
        expect(ortbRequest.gdprConsent.gdprApplies).to.equal(false);
        expect(ortbRequest.gdprConsent.consentGiven).to.equal(undefined);
      });
    });

    it('should properly build a mixed request', () => {
      const bidderRequest = { timeout: 3000 };
      const bidRequests = [
        {
          bidder: 'criteo',
          adUnitCode: 'bid-123',
          transactionId: 'transaction-123',
          sizes: [[728, 90]],
          params: {
            zoneId: 123,
          },
        },
        {
          bidder: 'criteo',
          adUnitCode: 'bid-234',
          transactionId: 'transaction-234',
          sizes: [[300, 250], [728, 90]],
          params: {
            networkId: 456,
          },
        },
      ];

      return spec.buildRequests(bidRequests, bidderRequest).promise.then(_ => {
        expect(requests).to.have.length(1);
        const request = requests[0];
        expect(request.url).to.match(/^\/\/bidder\.criteo\.com\/cdb\?profileId=207&av=\d+&wv=[^&]+&cb=\d/);
        expect(request.method).to.equal('POST');
        const ortbRequest = JSON.parse(request.requestBody);
        expect(ortbRequest.publisher.url).to.equal(utils.getTopWindowUrl());
        expect(ortbRequest.publisher.networkid).to.equal(456);
        expect(ortbRequest.slots).to.have.lengthOf(2);
        expect(ortbRequest.slots[0].impid).to.equal('bid-123');
        expect(ortbRequest.slots[0].transactionid).to.equal('transaction-123');
        expect(ortbRequest.slots[0].sizes).to.have.lengthOf(1);
        expect(ortbRequest.slots[0].sizes[0]).to.equal('728x90');
        expect(ortbRequest.slots[1].impid).to.equal('bid-234');
        expect(ortbRequest.slots[1].transactionid).to.equal('transaction-234');
        expect(ortbRequest.slots[1].sizes).to.have.lengthOf(2);
        expect(ortbRequest.slots[1].sizes[0]).to.equal('300x250');
        expect(ortbRequest.slots[1].sizes[1]).to.equal('728x90');
        expect(ortbRequest.gdprConsent).to.equal(undefined);
      });
    });

    it('should properly build request with undefined gdpr consent fields when they are not provided', () => {
      const bidRequests = [
        {
          bidder: 'criteo',
          adUnitCode: 'bid-123',
          transactionId: 'transaction-123',
          sizes: [[728, 90]],
          params: {
            zoneId: 123,
          },
        },
      ];
      const bidderRequest = { timeout: 3000,
        gdprConsent: {
        },
      };

      return spec.buildRequests(bidRequests, bidderRequest).promise.then(_ => {
        expect(requests).to.have.length(1);
        const request = requests[0];
        const ortbRequest = JSON.parse(request.requestBody);
        expect(ortbRequest.gdprConsent.consentData).to.equal(undefined);
        expect(ortbRequest.gdprConsent.gdprApplies).to.equal(undefined);
        expect(ortbRequest.gdprConsent.consentGiven).to.equal(undefined);
      });
    });
  });

  describe('when pubtag prebid adapter is available', function () {
    it('should forward response to pubtag when calling interpretResponse', () => {
      const response = {};
      const request = {};

      const adapter = { interpretResponse: function() {} };
      const adapterMock = sinon.mock(adapter);
      adapterMock.expects('interpretResponse').withExactArgs(response, request).once().returns('ok');
      const prebidAdapter = { GetAdapter: function() {} };
      const prebidAdapterMock = sinon.mock(prebidAdapter);
      prebidAdapterMock.expects('GetAdapter').withExactArgs(request).once().returns(adapter);

      global.Criteo = {
        PubTag: {
          Adapters: {
            Prebid: prebidAdapter
          }
        }
      };

      expect(spec.interpretResponse(response, request)).equal('ok');
      adapterMock.verify();
      prebidAdapterMock.verify();
    });

    it('should forward bid to pubtag when calling onBidWon', () => {
      const bid = { auctionId: 123 };

      const adapter = { handleBidWon: function() {} };
      const adapterMock = sinon.mock(adapter);
      adapterMock.expects('handleBidWon').withExactArgs(bid).once();
      const prebidAdapter = { GetAdapter: function() {} };
      const prebidAdapterMock = sinon.mock(prebidAdapter);
      prebidAdapterMock.expects('GetAdapter').withExactArgs(bid.auctionId).once().returns(adapter);

      global.Criteo = {
        PubTag: {
          Adapters: {
            Prebid: prebidAdapter
          }
        }
      };

      spec.onBidWon(bid);
      adapterMock.verify();
      prebidAdapterMock.verify();
    });

    it('should forward bid to pubtag when calling onSetTargeting', () => {
      const bid = { auctionId: 123 };

      const adapter = { handleSetTargeting: function() {} };
      const adapterMock = sinon.mock(adapter);
      adapterMock.expects('handleSetTargeting').withExactArgs(bid).once();
      const prebidAdapter = { GetAdapter: function() {} };
      const prebidAdapterMock = sinon.mock(prebidAdapter);
      prebidAdapterMock.expects('GetAdapter').withExactArgs(bid.auctionId).once().returns(adapter);

      global.Criteo = {
        PubTag: {
          Adapters: {
            Prebid: prebidAdapter
          }
        }
      };

      spec.onSetTargeting(bid);
      adapterMock.verify();
      prebidAdapterMock.verify();
    });

    it('should forward bid to pubtag when calling onTimeout', () => {
      const timeoutData = { auctionId: 123 };

      const adapter = { handleBidTimeout: function() {} };
      const adapterMock = sinon.mock(adapter);
      adapterMock.expects('handleBidTimeout').once();
      const prebidAdapter = { GetAdapter: function() {} };
      const prebidAdapterMock = sinon.mock(prebidAdapter);
      prebidAdapterMock.expects('GetAdapter').withExactArgs(timeoutData.auctionId).once().returns(adapter);

      global.Criteo = {
        PubTag: {
          Adapters: {
            Prebid: prebidAdapter
          }
        }
      };

      spec.onTimeout(timeoutData);
      adapterMock.verify();
      prebidAdapterMock.verify();
    });

    it('should directly return a POST method instead of a PROMISE when calling buildRequests', () => {
      const bidRequests = { };
      const bidderRequest = { };

      const prebidAdapter = { buildCdbUrl: function() {}, buildCdbRequest: function() {} };
      const prebidAdapterMock = sinon.mock(prebidAdapter);
      prebidAdapterMock.expects('buildCdbUrl').once().returns('cdbUrl');
      prebidAdapterMock.expects('buildCdbRequest').once().returns('cdbRequest');

      const adapters = { Prebid: function() {} };
      const adaptersMock = sinon.mock(adapters);
      adaptersMock.expects('Prebid').withExactArgs(PROFILE_ID_PUBLISHERTAG, ADAPTER_VERSION, bidRequests, bidderRequest, '$prebid.version$').once().returns(prebidAdapter);

      global.Criteo = {
        PubTag: {
          Adapters: adapters
        }
      };

      const buildRequestsResult = spec.buildRequests(bidRequests, bidderRequest);
      expect(buildRequestsResult.method).equal('POST');
      expect(buildRequestsResult.url).equal('cdbUrl');
      expect(buildRequestsResult.data).equal('cdbRequest');

      adaptersMock.verify();
      prebidAdapterMock.verify();
    });
  });

  describe('interpretResponse', function () {
    it('should return an empty array when parsing a no bid response', function () {
      const response = {};
      const request = { bidRequests: [] };
      const bids = spec.interpretResponse(response, request);
      expect(bids).to.have.lengthOf(0);
    });

    it('should properly parse a bid response with a networkId', function () {
      const response = {
        body: {
          slots: [{
            impid: 'test-requestId',
            cpm: 1.23,
            creative: 'test-ad',
            width: 728,
            height: 90,
          }],
        },
      };
      const request = {
        bidRequests: [{
          adUnitCode: 'test-requestId',
          bidId: 'test-bidId',
          params: {
            networkId: 456,
          }
        }]
      };
      const bids = spec.interpretResponse(response, request);
      expect(bids).to.have.lengthOf(1);
      expect(bids[0].requestId).to.equal('test-bidId');
      expect(bids[0].cpm).to.equal(1.23);
      expect(bids[0].ad).to.equal('test-ad');
      expect(bids[0].width).to.equal(728);
      expect(bids[0].height).to.equal(90);
    });

    it('should properly parse a bid responsewith with a zoneId', function () {
      const response = {
        body: {
          slots: [{
            impid: 'test-requestId',
            bidId: 'abc123',
            cpm: 1.23,
            creative: 'test-ad',
            width: 728,
            height: 90,
            zoneid: 123,
          }],
        },
      };
      const request = {
        bidRequests: [{
          adUnitCode: 'test-requestId',
          bidId: 'test-bidId',
          params: {
            zoneId: 123,
          },
        }]
      };
      const bids = spec.interpretResponse(response, request);
      expect(bids).to.have.lengthOf(1);
      expect(bids[0].requestId).to.equal('test-bidId');
      expect(bids[0].adId).to.equal('abc123');
      expect(bids[0].cpm).to.equal(1.23);
      expect(bids[0].ad).to.equal('test-ad');
      expect(bids[0].width).to.equal(728);
      expect(bids[0].height).to.equal(90);
    });

    it('should properly parse a bid responsewith with a zoneId passed as a string', function () {
      const response = {
        body: {
          slots: [{
            impid: 'test-requestId',
            cpm: 1.23,
            creative: 'test-ad',
            width: 728,
            height: 90,
            zoneid: 123,
          }],
        },
      };
      const request = {
        bidRequests: [{
          adUnitCode: 'test-requestId',
          bidId: 'test-bidId',
          params: {
            zoneId: '123',
          },
        }]
      };
      const bids = spec.interpretResponse(response, request);
      expect(bids).to.have.lengthOf(1);
      expect(bids[0].requestId).to.equal('test-bidId');
      expect(bids[0].cpm).to.equal(1.23);
      expect(bids[0].ad).to.equal('test-ad');
      expect(bids[0].width).to.equal(728);
      expect(bids[0].height).to.equal(90);
    });

    it('should generate unique adIds if none are returned by the endpoint', function () {
      const response = {
        body: {
          slots: [{
            impid: 'test-requestId',
            cpm: 1.23,
            creative: 'test-ad',
            width: 300,
            height: 250,
          }, {
            impid: 'test-requestId',
            cpm: 4.56,
            creative: 'test-ad',
            width: 728,
            height: 90,
          }],
        },
      };
      const request = {
        bidRequests: [{
          adUnitCode: 'test-requestId',
          bidId: 'test-bidId',
          sizes: [[300, 250], [728, 90]],
          params: {
            networkId: 456,
          }
        }]
      };
      const bids = spec.interpretResponse(response, request);
      expect(bids).to.have.lengthOf(2);
      const prebidBids = bids.map(bid => Object.assign(createBid(CONSTANTS.STATUS.GOOD, request.bidRequests[0]), bid));
      expect(prebidBids[0].adId).to.not.equal(prebidBids[1].adId);
    });
  });

  describe('cryptoVerifyAsync', function () {
    const TEST_HASH = 'azerty';
    const ALGO = { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } };

    it('should fail silently and return undefined if hash line is missing or corrupted', () => {
      localStorageMock.expects('getItem').withExactArgs('criteo_fast_bid').once().returns('// Has');
      expect(tryGetCriteoFastBid()).to.be.undefined;
    });

    it('should fail silently and return undefined if browser does not support any subtle api', () => {
      let publisherTag = '';
      localStorageMock.expects('getItem').withExactArgs('criteo_fast_bid').once().returns('// Hash: ' + TEST_HASH + '\n' + publisherTag);

      replaceWindowProperty('crypto', undefined);
      replaceWindowProperty('msCrypto', undefined);
      expect(tryGetCriteoFastBid()).to.be.undefined;
    });

    it('should fail silently and return undefined if cryptoVerifyAsync call throw an exception', () => {
      let publisherTag = '';
      localStorageMock.expects('getItem').withExactArgs('criteo_fast_bid').once().returns('// Hash: ' + TEST_HASH + '\n' + publisherTag);

      let subtle = { importKey: function() {}, verify: function() {} };
      let subtleMock = sinon.mock(subtle);
      replaceWindowProperty('crypto', { subtle });
      subtleMock.expects('importKey').withExactArgs('jwk', FAST_BID_PUBKEY, ALGO, false, ['verify']).once().throwsException();

      expect(tryGetCriteoFastBid()).to.be.undefined;
    });

    it('should be able to successfully load, validate and then execute the fast bid script when running on a browser that supports crypto.subtle', () => {
      let publisherTag = 'window.ensureEvalCalled.mark();';
      localStorageMock.expects('getItem').withExactArgs('criteo_fast_bid').once().returns('// Hash: ' + TEST_HASH + '\n' + publisherTag);

      let subtle = { importKey: function() {}, verify: function() {} };
      let subtleMock = sinon.mock(subtle);

      replaceWindowProperty('crypto', { subtle });

      let cryptoKey = 'cryptoKey';
      subtleMock.expects('importKey').withExactArgs('jwk', FAST_BID_PUBKEY, ALGO, false, ['verify']).once().returns(Promise.resolve(cryptoKey));
      subtleMock.expects('verify').withExactArgs(ALGO, cryptoKey, str2ab(atob(TEST_HASH)), str2ab(publisherTag)).once().returns(Promise.resolve('ok'));

      let ensureEvalCalled = { mark: function() {} };
      let ensureEvalCalledMock = sinon.mock(ensureEvalCalled);
      replaceWindowProperty('ensureEvalCalled', ensureEvalCalled);
      ensureEvalCalledMock.expects('mark').once();

      return tryGetCriteoFastBid().then(result => {
        subtleMock.verify();
        ensureEvalCalledMock.verify();
        expect(result).to.equal('ok');
      });
    });

    it('should return promise that ends with an undefined result when running on a browser that supports crypto.subtle and importKey call failed', () => {
      let publisherTag = '';
      localStorageMock.expects('getItem').withExactArgs('criteo_fast_bid').once().returns('// Hash: ' + TEST_HASH + '\n' + publisherTag);

      let subtle = { importKey: function() {}, verify: function() {} };
      let subtleMock = sinon.mock(subtle);

      subtleMock.expects('importKey').withExactArgs('jwk', FAST_BID_PUBKEY, ALGO, false, ['verify']).once().returns(Promise.reject(new Error('failure')));
      subtleMock.expects('verify').never();

      replaceWindowProperty('crypto', { subtle });

      return tryGetCriteoFastBid().then(result => {
        expect(result).to.be.undefined;
        subtleMock.verify();
      });
    });

    it('should return promise that ends with an undefined result when running on a browser that supports crypto.subtle and verify call failed', () => {
      let publisherTag = '';
      localStorageMock.expects('getItem').withExactArgs('criteo_fast_bid').once().returns('// Hash: ' + TEST_HASH + '\n' + publisherTag);

      let subtle = { importKey: function() {}, verify: function() {} };
      let subtleMock = sinon.mock(subtle);

      let cryptoKey = 'cryptoKey';
      subtleMock.expects('importKey').withExactArgs('jwk', FAST_BID_PUBKEY, ALGO, false, ['verify']).once().returns(Promise.resolve(cryptoKey));
      subtleMock.expects('verify').withExactArgs(ALGO, cryptoKey, str2ab(atob(TEST_HASH)), str2ab(publisherTag)).once().returns(Promise.reject(new Error('failure')));

      replaceWindowProperty('crypto', { subtle });

      return tryGetCriteoFastBid().then(result => {
        expect(result).to.be.undefined;
        subtleMock.verify();
      });
    });

    it('should be able to successfully load, validate and then execute the fast bid script when running on a browser that supports crypto.webkitSubtle', () => {
      let publisherTag = 'window.ensureEvalCalled.mark();';
      localStorageMock.expects('getItem').withExactArgs('criteo_fast_bid').once().returns('// Hash: ' + TEST_HASH + '\n' + publisherTag);

      let webkitSubtle = { importKey: function() {}, verify: function() {} };
      let webkitSubtleMock = sinon.mock(webkitSubtle);

      replaceWindowProperty('crypto', { webkitSubtle });

      let cryptoKey = 'cryptoKey';
      webkitSubtleMock.expects('importKey').withExactArgs('jwk', FAST_BID_PUBKEY, ALGO, false, ['verify']).once().returns(Promise.resolve(cryptoKey));
      webkitSubtleMock.expects('verify').withExactArgs(ALGO, cryptoKey, str2ab(atob(TEST_HASH)), str2ab(publisherTag)).once().returns(Promise.resolve('ok'));

      let ensureEvalCalled = { mark: function() {} };
      let ensureEvalCalledMock = sinon.mock(ensureEvalCalled);
      replaceWindowProperty('ensureEvalCalled', ensureEvalCalled);
      ensureEvalCalledMock.expects('mark').once();

      return tryGetCriteoFastBid().then(result => {
        webkitSubtleMock.verify();
        ensureEvalCalledMock.verify();
        expect(result).to.equal('ok');
      });
    });

    it('should return promise that ends with an undefined result when running on a browser that supports crypto.msCrypto and importKey call failed', () => {
      let publisherTag = '';
      localStorageMock.expects('getItem').withExactArgs('criteo_fast_bid').once().returns('// Hash: ' + TEST_HASH + '\n' + publisherTag);

      let subtle = { importKey: function() {}, verify: function() {} };
      let subtleMock = sinon.mock(subtle);

      let importKeyOperationProxy = new Proxy({ }, {
        set: (_, property, value) => {
          if (property == 'onerror') {
            value(new Error('failure'));
          }
          return true;
        }
      });
      subtleMock.expects('importKey').withExactArgs('jwk', str2ab(JSON.stringify(FAST_BID_PUBKEY)), ALGO, false, ['verify']).once().returns(importKeyOperationProxy);
      subtleMock.expects('verify').never();

      replaceWindowProperty('msCrypto', { subtle });

      return tryGetCriteoFastBid().then(result => {
        expect(result).to.be.undefined;
        subtleMock.verify();
      });
    });

    it('should return promise that ends with an undefined result when running on a browser that supports crypto.msCrypto an exception is thrown by one of its method', () => {
      let publisherTag = '';
      localStorageMock.expects('getItem').withExactArgs('criteo_fast_bid').once().returns('// Hash: ' + TEST_HASH + '\n' + publisherTag);

      let subtle = { importKey: function() {}, verify: function() {} };
      let subtleMock = sinon.mock(subtle);

      subtleMock.expects('importKey').withExactArgs('jwk', str2ab(JSON.stringify(FAST_BID_PUBKEY)), ALGO, false, ['verify']).once().throwsException();
      subtleMock.expects('verify').never();

      replaceWindowProperty('msCrypto', { subtle });

      return tryGetCriteoFastBid().then(result => {
        expect(result).to.be.undefined;
        subtleMock.verify();
      });
    });

    it('should return promise that ends with an undefined result when running on a browser that supports crypto.msCrypto and verify call failed', () => {
      let publisherTag = '';
      localStorageMock.expects('getItem').withExactArgs('criteo_fast_bid').once().returns('// Hash: ' + TEST_HASH + '\n' + publisherTag);

      let subtle = { importKey: function() {}, verify: function() {} };
      let subtleMock = sinon.mock(subtle);

      let cryptoKey = 'abc';

      let importKeyOperationProxy = new Proxy({ }, {
        set: (_, property, value) => {
          if (property == 'oncomplete') {
            value({
              target: {
                result: cryptoKey
              }
            });
          }
          return true;
        }
      });
      subtleMock.expects('importKey').withExactArgs('jwk', str2ab(JSON.stringify(FAST_BID_PUBKEY)), ALGO, false, ['verify']).once().returns(importKeyOperationProxy);
      let verifyOperationProxy = new Proxy({ }, {
        set: (_, property, value) => {
          if (property == 'onerror') {
            value(new Error('failure'));
          }
          return true;
        }
      });
      subtleMock.expects('verify').withExactArgs(ALGO, cryptoKey, str2ab(atob(TEST_HASH)), str2ab('test wrong')).once().returns(verifyOperationProxy);

      replaceWindowProperty('msCrypto', { subtle });

      return tryGetCriteoFastBid().then(result => {
        expect(result).to.be.undefined;
        subtleMock.verify();
      });
    });

    it('should be able to successfully load, validate and then execute the fast bid script when running on a browser that supports window.msCrypto', () => {
      let publisherTag = 'window.ensureEvalCalled.mark();';
      localStorageMock.expects('getItem').withExactArgs('criteo_fast_bid').once().returns('// Hash: ' + TEST_HASH + '\n' + publisherTag);

      let subtle = { importKey: function() {}, verify: function() {} };
      let subtleMock = sinon.mock(subtle);

      replaceWindowProperty('msCrypto', { subtle });

      let cryptoKey = 'abc';

      let importKeyOperationProxy = new Proxy({ }, {
        set: (_, property, value) => {
          if (property == 'oncomplete') {
            value({
              target: {
                result: cryptoKey
              }
            });
          }
          return true;
        }
      });
      subtleMock.expects('importKey').withExactArgs('jwk', str2ab(JSON.stringify(FAST_BID_PUBKEY)), ALGO, false, ['verify']).once().returns(importKeyOperationProxy);
      let verifyOperationProxy = new Proxy({ }, {
        set: (_, property, value) => {
          if (property == 'oncomplete') {
            value({
              target: {
                result: 'ok'
              }
            });
          }
          return true;
        }
      });
      subtleMock.expects('verify').withExactArgs(ALGO, cryptoKey, str2ab(atob(TEST_HASH)), str2ab(publisherTag)).once().returns(verifyOperationProxy);

      let ensureEvalCalled = { mark: function() {} };
      let ensureEvalCalledMock = sinon.mock(ensureEvalCalled);
      replaceWindowProperty('ensureEvalCalled', ensureEvalCalled);
      ensureEvalCalledMock.expects('mark').once();

      return tryGetCriteoFastBid().then(result => {
        subtleMock.verify();
        ensureEvalCalledMock.verify();
        expect(result).to.equal('ok');
      });
    });
  });
});
