import Anthropic from '@anthropic-ai/sdk';

export const bookingTools: Anthropic.Tool[] = [
  {
    name: 'create_booking',
    description: 'Create a new booking at a specific time',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short title for the booking' },
        start_time: { type: 'string', description: 'ISO 8601 datetime in UTC' },
        end_time: { type: 'string', description: 'ISO 8601 datetime in UTC' },
        timezone: { type: 'string', description: 'IANA timezone string (e.g. Africa/Johannesburg)' },
        description: { type: 'string', description: 'Optional description' },
      },
      required: ['title', 'start_time', 'end_time', 'timezone'],
    },
  },
  {
    name: 'cancel_booking',
    description: 'Cancel an existing booking by ID or description',
    input_schema: {
      type: 'object',
      properties: {
        booking_id: { type: 'string', description: 'The booking UUID to cancel' },
        reason: { type: 'string', description: 'Optional cancellation reason' },
      },
      required: ['booking_id'],
    },
  },
  {
    name: 'reschedule_booking',
    description: 'Move an existing booking to a new time',
    input_schema: {
      type: 'object',
      properties: {
        booking_id: { type: 'string', description: 'The booking UUID to reschedule' },
        new_start_time: { type: 'string', description: 'ISO 8601 datetime in UTC' },
        new_end_time: { type: 'string', description: 'ISO 8601 datetime in UTC' },
        timezone: { type: 'string', description: 'IANA timezone string' },
      },
      required: ['booking_id', 'new_start_time', 'new_end_time', 'timezone'],
    },
  },
  {
    name: 'query_availability',
    description: 'Check available time slots for a given date',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Date in YYYY-MM-DD format (UTC)' },
        duration_minutes: { type: 'number', description: 'Required slot duration in minutes', default: 30 },
      },
      required: ['date'],
    },
  },
  {
    name: 'query_bookings',
    description: 'Look up existing bookings within a date range',
    input_schema: {
      type: 'object',
      properties: {
        start_after: { type: 'string', description: 'ISO 8601 datetime lower bound' },
        start_before: { type: 'string', description: 'ISO 8601 datetime upper bound' },
      },
      required: [],
    },
  },
];
