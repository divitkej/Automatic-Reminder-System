'use strict';

const express = require('express');
const config = require('../config');
const { page, escapeHtml } = require('../lib/render');

const router = express.Router();

const UPDATED = '22 September 2026';

router.get('/privacy', (req, res) => {
  res.type('html').send(page({
    title: 'Privacy notice',
    heading: 'Privacy notice',
    subheading: `How Career Services uses student data in this system. Last updated ${UPDATED}.`,
    body: `
      <h2>Who holds this data</h2>
      <p>${escapeHtml(config.org.name)} operates this system and is responsible for the personal data in it.</p>

      <h2>What is held</h2>
      <ul>
        <li>Your name, campus identity number, campus email address and, where the campus holds one, your mobile number.</li>
        <li>Your programme, discipline, year of study and admission batch, which decide which events you are told about.</li>
        <li>Your response to each invitation, whether you attended, and the feedback you submit.</li>
        <li>A record of every message sent to you: when it was sent, whether it was delivered, whether the email was opened and whether a link in it was followed.</li>
      </ul>

      <h2>Why it is held</h2>
      <p>To invite you to Career Services events, remind you about the ones you have a place at, tell you when arrangements change, and understand which sessions are worth running again. This is part of the careers and placement support the campus provides to enrolled students.</p>

      <h2>Who it is shared with</h2>
      <p>Nobody outside the campus, except as follows. Feedback is shared with speakers and partner organisations only as averages and unattributed comments. Email is delivered through the campus mail service; where SMS or WhatsApp is used, the message and your number pass through the gateway the campus has contracted for that purpose. Your data is not sold, and it is not used for advertising.</p>

      <h2>How long it is kept</h2>
      <p>Event records and attendance are kept while you are enrolled and for the reporting period that follows, in line with campus record keeping. Message delivery records are kept so that a query about a missed invitation can be answered.</p>

      <h2>Your choices</h2>
      <ul>
        <li>Ask to see what is held about you, or to have an error corrected, by writing to <a href="mailto:${escapeHtml(config.org.email)}">${escapeHtml(config.org.email)}</a>.</li>
        <li>Ask to be taken off non-essential Career Services mail. Requests are actioned by the team rather than by an automatic link, so that a student is not removed from placement communication by accident.</li>
        <li>Decline any invitation without giving a reason. Declining is recorded, and it frees your place for another student.</li>
      </ul>

      <h2>Tracking</h2>
      <p>Emails from this system carry a small image that records when a message is opened, and links carry a reference that records when they are followed. This is used to tell whether a reminder reached students, not to build a profile. These pages set no cookies and carry no third party scripts.</p>

      <h2>Contact</h2>
      <p>Questions about this notice go to <a href="mailto:${escapeHtml(config.org.email)}">${escapeHtml(config.org.email)}</a> or ${escapeHtml(config.org.phone)}.</p>
    `,
  }));
});

router.get('/terms', (req, res) => {
  res.type('html').send(page({
    title: 'Terms of use',
    heading: 'Terms of use',
    subheading: `Terms for students and staff using this system. Last updated ${UPDATED}.`,
    body: `
      <h2>Who this is for</h2>
      <p>This system is operated by ${escapeHtml(config.org.name)} for enrolled students and for Career Services staff. Access is through a personal link sent to your campus email address, or through a staff account.</p>

      <h2>Your personal links</h2>
      <p>The registration and feedback links sent to you are specific to you. Sharing one lets another person answer in your name, so treat it as you would a password. If you think a link has been shared, tell Career Services and it will be reissued.</p>

      <h2>Places at events</h2>
      <ul>
        <li>Confirming a place is a commitment to attend. Many sessions are oversubscribed and a confirmed place that goes unused is a place another student could not take.</li>
        <li>Where an event has a capacity, confirmations past that point join a waiting list and are promoted automatically when a place is released.</li>
        <li>If you cannot attend, decline through your link. Declining in advance carries no penalty.</li>
        <li>Repeated failure to attend confirmed places may be taken into account when places at oversubscribed sessions are allocated.</li>
      </ul>

      <h2>Conduct at events</h2>
      <p>Career Services events frequently involve visiting organisations and their senior staff. Campus conduct rules apply in full, in person and online, and the arrangements sent with each invitation, including dress code and arrival time, form part of them.</p>

      <h2>Feedback</h2>
      <p>Feedback should be given in good faith. It is read by the Career Services team and reported to speakers and partners as averages and unattributed comments. Do not include personal data about other people in a feedback answer.</p>

      <h2>Availability</h2>
      <p>The system is provided as it stands. Career Services aims to deliver every message on time, but delivery depends on campus mail, mobile networks and providers outside its control. If an event matters to you, add it to your calendar rather than relying on a reminder arriving.</p>

      <h2>Changes</h2>
      <p>These terms may be updated. The date above shows when they last changed. Questions go to <a href="mailto:${escapeHtml(config.org.email)}">${escapeHtml(config.org.email)}</a>.</p>
    `,
  }));
});

module.exports = router;
