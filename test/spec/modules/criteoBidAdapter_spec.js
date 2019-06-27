import { expect } from 'chai';
import { cryptoVerifyAsync, str2ab, spec, FAST_BID_PUBKEY } from 'modules/criteoBidAdapter';
import { createBid } from 'src/bidfactory';
import CONSTANTS from 'src/constants.json';
import * as utils from 'src/utils';

describe('The Criteo bidding adapter', function () {
  let xhr;
  let requests;

  beforeEach(function () {
    // Remove FastBid to avoid side effects.
    localStorage.removeItem('criteo_fast_bid');

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

    it('should properly build a zoneId request', function (done) {
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
      spec.buildRequests(bidRequests, bidderRequest).promise.then(_ => {
        expect(requests).to.have.length(1);
        const request = requests[0];
        expect(request.url).to.match(/^\/\/bidder\.criteo\.com\/cdb\?profileId=207&av=\d+&wv=[^&]+&cb=\d/);
        expect(request.method).to.equal('POST');
        const ortbRequest = JSON.parse(request.requestBody);
        expect(ortbRequest.publisher.url).to.equal(utils.getTopWindowUrl());
        expect(ortbRequest.slots).to.have.lengthOf(1);
        expect(ortbRequest.slots[0].impid).to.equal('bid-123');
        expect(ortbRequest.slots[0].transactionid).to.equal('transaction-123');
        expect(ortbRequest.slots[0].sizes).to.have.lengthOf(1);
        expect(ortbRequest.slots[0].sizes[0]).to.equal('728x90');
        expect(ortbRequest.slots[0].zoneid).to.equal(123);
        expect(ortbRequest.gdprConsent.consentData).to.equal('concentDataString');
        expect(ortbRequest.gdprConsent.gdprApplies).to.equal(true);
        expect(ortbRequest.gdprConsent.consentGiven).to.equal(true);
        done();
      });
    });

    it('should properly build a networkId request', function (done) {
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
      spec.buildRequests(bidRequests, bidderRequest).promise.then(_ => {
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
        done();
      });
    });

    it('should properly build a mixed request', function (done) {
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
      spec.buildRequests(bidRequests, bidderRequest).promise.then(_ => {
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
        done();
      });
    });

    it('should properly build request with undefined gdpr consent fields when they are not provided', function (done) {
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

      spec.buildRequests(bidRequests, bidderRequest).promise.then(_ => {
        expect(requests).to.have.length(1);
        const request = requests[0];
        const ortbRequest = JSON.parse(request.requestBody);
        expect(ortbRequest.gdprConsent.consentData).to.equal(undefined);
        expect(ortbRequest.gdprConsent.gdprApplies).to.equal(undefined);
        expect(ortbRequest.gdprConsent.consentGiven).to.equal(undefined);
        done();
      });
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
    const TEST_HASH = 'vBeD8Q7GU6lypFbzB07W8hLGj7NL+p7dI9ro2tCxkrmyv0F6stNuoNd75Us33iNKfEoW+cFWypelr6OJPXxki2MXWatRhJuUJZMcK4VBFnxi3Ro+3a0xEfxE4jJm4eGe98iC898M+/YFHfp+fEPEnS6pEyw124ONIFZFrcejpHU=';
    const ALGO = { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } };

    var propertiesToRestore;

    // sinon version installed by dev-deps doesn't support the replaceGetter for objects like window
    // and upgrading to the latest sinon generates a tons of warning accross all modules
    function replaceWindowProperty(propertyName, replacement) {
      var tmpObject = {}
      tmpObject[propertyName] = window[propertyName];
      propertiesToRestore = { ...propertiesToRestore, ...tmpObject };

      Object.defineProperty(window, propertyName, {
        get: function () { return replacement; },
        configurable: true
      });
    }

    beforeEach(function() {
      propertiesToRestore = {};
    });

    afterEach(function() {
      for (var property in propertiesToRestore) {
        if (propertiesToRestore.hasOwnProperty(property)) {
          Object.defineProperty(window, property, {
            get: function () { return propertiesToRestore[property]; }
          });
        }
      }
    });

    it('should reject with an error when running on a browser that exposes window.crypto.subtle and importKey call failed', function () {
      var subtle = { importKey: function() {}, verify: function() {} };
      var subtleMock = sinon.mock(subtle);

      subtleMock.expects('importKey').withExactArgs('jwk', FAST_BID_PUBKEY, ALGO, false, ['verify']).once().returns(Promise.reject(new Error('failure')));
      subtleMock.expects('verify').never();

      replaceWindowProperty('crypto', { subtle });

      cryptoVerifyAsync(FAST_BID_PUBKEY, TEST_HASH, 'test').then(x => {
        expect.fail(null, null, 'cryptoVerifyAsync did not reject with an error');
        done();
      }).catch(_ => {
        subtleMock.verify();
        done();
      });
    });

    it('should reject with an error when running on a browser that exposes window.crypto.subtle and verify failed', function () {
      var subtle = { importKey: function() {}, verify: function() {} };
      var subtleMock = sinon.mock(subtle);

      var cryptoKey = 'abc';

      subtleMock.expects('importKey').withExactArgs('jwk', FAST_BID_PUBKEY, ALGO, false, ['verify']).once().returns(Promise.resolve(cryptoKey));
      subtleMock.expects('verify').withExactArgs(ALGO, cryptoKey, str2ab(atob(TEST_HASH)), str2ab('test wrong')).once().returns(Promise.reject(new Error('failure')));

      replaceWindowProperty('crypto', { subtle });

      cryptoVerifyAsync(FAST_BID_PUBKEY, TEST_HASH, 'test wrong').then(x => {
        expect.fail(null, null, 'cryptoVerifyAsync did not reject with an error');
        done();
      }).catch(_ => {
        subtleMock.verify();
        done();
      });
    });

    it('should resolve when running on a browser that exposes window.crypto.subtle and all goes successfully', function () {
      var subtle = { importKey: function() {}, verify: function() {} };
      var subtleMock = sinon.mock(subtle);

      var cryptoKey = 'abc';

      subtleMock.expects('importKey').withExactArgs('jwk', FAST_BID_PUBKEY, ALGO, false, ['verify']).once().returns(Promise.resolve(cryptoKey));
      subtleMock.expects('verify').withExactArgs(ALGO, cryptoKey, str2ab(atob(TEST_HASH)), str2ab('test wrong')).once().returns(Promise.resolve('ok'));

      replaceWindowProperty('crypto', { subtle });

      cryptoVerifyAsync(FAST_BID_PUBKEY, TEST_HASH, 'test wrong').then(result => {
        result.should.be('string', 'ok');
        subtleMock.verify();
        done();
      }).catch(_ => {
        expect.fail(null, null, 'cryptoVerifyAsync reject with an error');
        done();
      });
    });

    it('should reject with an error when running on a browser that exposes window.crypto.webkitSubtle and importKey call failed', function () {
      var webkitSubtle = { importKey: function() {}, verify: function() {} };
      var webkitSubtleMock = sinon.mock(webkitSubtle);

      webkitSubtleMock.expects('importKey').withExactArgs('jwk', FAST_BID_PUBKEY, ALGO, false, ['verify']).once().returns(Promise.reject(new Error('failure')));
      webkitSubtleMock.expects('verify').never();

      replaceWindowProperty('crypto', { webkitSubtle });

      cryptoVerifyAsync(FAST_BID_PUBKEY, TEST_HASH, 'test').then(x => {
        expect.fail(null, null, 'cryptoVerifyAsync did not reject with an error');
        done();
      }).catch(_ => {
        webkitSubtleMock.verify();
        done();
      });
    });

    it('should reject with an error when running on a browser that exposes window.crypto.webkitSubtle and verify failed', function () {
      var webkitSubtle = { importKey: function() {}, verify: function() {} };
      var webkitSubtleMock = sinon.mock(webkitSubtle);

      var cryptoKey = 'abc';

      webkitSubtleMock.expects('importKey').withExactArgs('jwk', FAST_BID_PUBKEY, ALGO, false, ['verify']).once().returns(Promise.resolve(cryptoKey));
      webkitSubtleMock.expects('verify').withExactArgs(ALGO, cryptoKey, str2ab(atob(TEST_HASH)), str2ab('test wrong')).once().returns(Promise.reject(new Error('failure')));

      replaceWindowProperty('crypto', { webkitSubtle });

      cryptoVerifyAsync(FAST_BID_PUBKEY, TEST_HASH, 'test wrong').then(x => {
        expect.fail(null, null, 'cryptoVerifyAsync did not reject with an error');
        done();
      }).catch(_ => {
        webkitSubtleMock.verify();
        done();
      });
    });

    it('should resolve when running on a browser that exposes window.crypto.webkitSubtle and all goes successfully', function () {
      var webkitSubtle = { importKey: function() {}, verify: function() {} };
      var webkitSubtleMock = sinon.mock(webkitSubtle);

      var cryptoKey = 'abc';

      webkitSubtleMock.expects('importKey').withExactArgs('jwk', FAST_BID_PUBKEY, ALGO, false, ['verify']).once().returns(Promise.resolve(cryptoKey));
      webkitSubtleMock.expects('verify').withExactArgs(ALGO, cryptoKey, str2ab(atob(TEST_HASH)), str2ab('test wrong')).once().returns(Promise.resolve('ok'));

      replaceWindowProperty('crypto', { webkitSubtle });

      cryptoVerifyAsync(FAST_BID_PUBKEY, TEST_HASH, 'test wrong').then(result => {
        result.should.be('string', 'ok');
        webkitSubtleMock.verify();
        done();
      }).catch(_ => {
        expect.fail(null, null, 'cryptoVerifyAsync reject with an error');
        done();
      });
    });

    it('should reject with an error when running on a browser that exposes window.msCrypto and importKey failed', function () {
      var subtle = { importKey: function() {}, verify: function() {} };
      var subtleMock = sinon.mock(subtle);

      var importKeyOperationProxy = new Proxy({ }, {
        set: (_, property, value) => {
          if(property == "onerror") {
            value(new Error("failure"));
          }
          return true;
        }
      });
      subtleMock.expects('importKey').withExactArgs('jwk', str2ab(JSON.stringify(FAST_BID_PUBKEY)), ALGO, false, ['verify']).once().returns(importKeyOperationProxy);
      subtleMock.expects('verify').never();

      replaceWindowProperty('msCrypto', { subtle });

      cryptoVerifyAsync(FAST_BID_PUBKEY, TEST_HASH, 'test').then(x => {
        expect.fail(null, null, 'cryptoVerifyAsync did not reject with an error');
        done();
      }).catch(e => {
        subtleMock.verify();
        done();
      });
    });

    it('should reject with an error when running on a browser that exposes window.msCrypto but throws an exception', function () {
      var subtle = { importKey: function() {}, verify: function() {} };
      var subtleMock = sinon.mock(subtle);

      subtleMock.expects('importKey').withExactArgs('jwk', str2ab(JSON.stringify(FAST_BID_PUBKEY)), ALGO, false, ['verify']).once().throwsException();
      subtleMock.expects('verify').never();

      replaceWindowProperty('msCrypto', { subtle });

      cryptoVerifyAsync(FAST_BID_PUBKEY, TEST_HASH, 'test').then(x => {
        expect.fail(null, null, 'cryptoVerifyAsync did not reject with an error');
        done();
      }).catch(_ => {
        subtleMock.verify();
        done();
      });
    });

    it('should reject with an error when running on a browser that exposes window.msCrypto and verify failed', function () {
      var subtle = { importKey: function() {}, verify: function() {} };
      var subtleMock = sinon.mock(subtle);

      var cryptoKey = 'abc';

      var importKeyOperationProxy = new Proxy({ }, {
        set: (_, property, value) => {
          if(property == "oncomplete") {
            value({
              target : {
                result: cryptoKey
              }
            });
          }
          return true;
        }
      });
      subtleMock.expects('importKey').withExactArgs('jwk', str2ab(JSON.stringify(FAST_BID_PUBKEY)), ALGO, false, ['verify']).once().returns(importKeyOperationProxy);
      var verifyOperationProxy = new Proxy({ }, {
        set: (_, property, value) => {
          if(property == "onerror") {
            value(new Error("failure"));
          }
          return true;
        }
      });
      subtleMock.expects('verify').withExactArgs(ALGO, cryptoKey, str2ab(atob(TEST_HASH)), str2ab('test wrong')).once().returns(verifyOperationProxy);

      replaceWindowProperty('msCrypto', { subtle });

      cryptoVerifyAsync(FAST_BID_PUBKEY, TEST_HASH, 'test wrong').then(x => {
        expect.fail(null, null, 'cryptoVerifyAsync did not reject with an error');
        done();
      }).catch(e => {
        subtleMock.verify();
        done();
      });
    });

    it('should resolve when running on a browser that exposes window.msCrypto and all goes successfully', function () {
      var subtle = { importKey: function() {}, verify: function() {} };
      var subtleMock = sinon.mock(subtle);

      var cryptoKey = 'abc';

      var importKeyOperationProxy = new Proxy({ }, {
        set: (_, property, value) => {
          if(property == "oncomplete") {
            value({
              target : {
                result: cryptoKey
              }
            });
          }
          return true;
        }
      });
      subtleMock.expects('importKey').withExactArgs('jwk', str2ab(JSON.stringify(FAST_BID_PUBKEY)), ALGO, false, ['verify']).once().returns(importKeyOperationProxy);
      var verifyOperationProxy = new Proxy({ }, {
        set: (_, property, value) => {
          if(property == "oncomplete") {
            value({
              target : {
                result: "ok"
              }
            });
          }
          return true;
        }
      });
      subtleMock.expects('verify').withExactArgs(ALGO, cryptoKey, str2ab(atob(TEST_HASH)), str2ab('test wrong')).once().returns(verifyOperationProxy);

      replaceWindowProperty('msCrypto', { subtle });

      cryptoVerifyAsync(FAST_BID_PUBKEY, TEST_HASH, 'test wrong').then(result => {
        result.should.be('string', 'ok');
        subtleMock.verify();
        done();
      }).catch(_ => {
        expect.fail(null, null, 'cryptoVerifyAsync reject with an error');
        done();
      });
    });

    it('should return undefined with incompatible browsers', function () {
      replaceWindowProperty('crypto', undefined);
      replaceWindowProperty('msCrypto', undefined);
      expect(cryptoVerifyAsync(FAST_BID_PUBKEY, TEST_HASH, 'test')).to.be.undefined;
    });
  });
});
