import { notifications } from '@mantine/notifications';
import { toRequestError } from './api';

/** Shows the API's one-line error. */
export function notifyError(error: unknown, title = 'Request failed'): void {
  notifications.show({ color: 'red', title, message: toRequestError(error).message, autoClose: 8000 });
}

export function notifySuccess(message: string): void {
  notifications.show({ color: 'teal', message, autoClose: 4000 });
}
