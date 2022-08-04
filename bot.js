// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const { ActivityHandler, MessageFactory } = require('botbuilder');

const { QnAMaker } = require('botbuilder-ai');
const DentistScheduler = require('./dentistscheduler');
const IntentRecognizer = require('./intentrecognizer');

const INTENT_SCORE_THRESHOLD = 0.6;

class DentaBot extends ActivityHandler {
  constructor(configuration, qnaOptions) {
    // call the parent constructor
    super();
    if (!configuration) throw new Error('[QnaMakerBot]: Missing parameter. configuration is required');

    // create a QnAMaker connector
    this.QnAMaker = new QnAMaker(configuration.QnAConfiguration, qnaOptions);
    // console.debug(configuration.QnAConfiguration)

    // create a DentistScheduler connector
    this.dentistScheduler = new DentistScheduler(configuration.SchedulerConfiguration);

    // create a IntentRecognizer connector
    this.intentRecognizer = new IntentRecognizer(configuration.LuisConfiguration);

    this.availableTimes = [];

    this.onMessage(async (context, next) => {
      // send user input to QnA Maker and collect the response in a variable
      // don't forget to use the 'await' keyword
      const qnaResults = await this.QnAMaker.getAnswers(context);

      // send user input to IntentRecognizer and collect the response in a variable
      // don't forget 'await'
      const luisResult = await this.intentRecognizer.executeLuisQuery(context);

      const luisTopIntent = luisResult?.luisResult.prediction.topIntent;

      if (luisTopIntent === 'getAvailability' && luisResult.intents.getAvailability?.score >= INTENT_SCORE_THRESHOLD) {
        // No instances
        await this.fetchAvailabilty();

        if (this.availableTimes.length > 0) {
          await context.sendActivity(`These are the available times: ${ this.availableTimes.join(', ') }`);
        } else {
          await context.sendActivity('There are no available times');
        }
        await next();
        return;
      }

      if (luisTopIntent === 'scheduleAppointment' && luisResult.intents.scheduleAppointment?.score >= INTENT_SCORE_THRESHOLD) {
        const instances = luisResult.entities?.$instance;

        if (instances && instances.scheduleTime && instances.scheduleTime[0]) {
          const selectedTime = instances.scheduleTime[0].text;

          await this.fetchAvailabilty();

          if (this.availableTimes.includes(selectedTime)) {
            await this.dentistScheduler.scheduleAppointment(selectedTime);
            await context.sendActivity(`Appointment set at ${ selectedTime }`);
          } else {
            await context.sendActivity('Selected time is not available');
          }

          await next();
          return;
        }
      }

      // determine which service to respond with based on the results from LUIS //

      // if(top intent is intentA and confidence greater than 50){
      //  doSomething();
      // await context.sendActivity(MessageFactory.text(context.activity.text, context.activity.text));
      //  await next();
      //  return;
      // }
      // else {...}
      // If an answer was received from QnA Maker, send the answer back to the user.
      if (qnaResults[0]) {
        await context.sendActivity(`${ qnaResults[0].answer }`);
      } else {
        // If no answers were returned from QnA Maker, reply with help.
        await context.sendActivity(
          'I\'m not sure I found an answer to your question\nYou can ask me questions about our dentistry services'
        );
      }

      await next();
    });

    this.onMembersAdded(async (context, next) => {
      const membersAdded = context.activity.membersAdded;
      // write a custom greeting
      const welcomeText = 'Hello';
      for (let cnt = 0; cnt < membersAdded.length; ++cnt) {
        if (membersAdded[cnt].id !== context.activity.recipient.id) {
          await context.sendActivity(MessageFactory.text(welcomeText, welcomeText));
        }
      }
      // by calling next() you ensure that the next BotHandler is run.
      await next();
    });
  }

  async fetchAvailabilty() {
    if (this.availableTimes.length < 1) {
      try {
        this.availableTimes = await this.dentistScheduler.getAvailability() || [];
      } catch (err) {
      }
    }
  }
}

module.exports.DentaBot = DentaBot;
