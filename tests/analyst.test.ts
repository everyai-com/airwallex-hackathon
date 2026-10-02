import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAnalyst } from '../src/core/analyst.js';

const forecast = {
  payer: 'Northwind Retail Group',
  amount: 8_000,
  currency: 'USD',
  expectedInHours: 18,
  confidence: 0.86,
  evidence: ['Bank feed shows an inbound ACH prenotification', 'Signed invoice NW-4417'],
};

test('analyst reads a contradiction out of unstructured email text', async () => {
  const analyst = createAnalyst({ forceHeuristic: true });
  const assessment = await analyst.assessForecast({
    forecast,
    newInformation:
      'Our treasury committee meets Friday, so the NW-4417 payment may slip by about a week. Sorry for the late notice.',
    source: 'ap@northwind-retail.example',
  });
  assert.equal(assessment.direction, 'contradicted');
  assert.equal(assessment.confidence, 0.42);
  assert.ok(assessment.citedEvidence.some((line) => line.toLowerCase().includes('slip')));
  assert.ok(assessment.rationale.length > 40);
});

test('analyst reaffirms a forecast when the text confirms it', async () => {
  const analyst = createAnalyst({ forceHeuristic: true });
  const assessment = await analyst.assessForecast({
    forecast,
    newInformation: 'The payment was processed this morning and sent to your account.',
  });
  assert.equal(assessment.direction, 'reaffirmed');
  assert.ok(assessment.confidence > forecast.confidence);
});

test('analyst weakens a forecast on neutral text', async () => {
  const analyst = createAnalyst({ forceHeuristic: true });
  const assessment = await analyst.assessForecast({
    forecast,
    newInformation: 'Please find the updated contract attached for your records.',
  });
  assert.equal(assessment.direction, 'weakened');
  assert.ok(assessment.confidence < forecast.confidence);
});

test('analyst selects Claude only when an API key is present', () => {
  assert.equal(createAnalyst().kind, 'heuristic');
  assert.equal(createAnalyst({ apiKey: 'sk-ant-test' }).kind, 'claude');
  assert.equal(createAnalyst({ apiKey: 'sk-ant-test', forceHeuristic: true }).kind, 'heuristic');
});

test('exception explanations name the counterparty and the amount held', async () => {
  const analyst = createAnalyst({ forceHeuristic: true });
  const note = await analyst.explainException({
    counterparty: 'Helios Advisory LLC',
    amount: 3_500,
    currency: 'USD',
    reason: 'New payee over USD 2,000 requires vendor onboarding approval',
  });
  assert.match(note, /Helios Advisory LLC/);
  assert.match(note, /USD 3500/);
  assert.match(note, /human review/);
});
