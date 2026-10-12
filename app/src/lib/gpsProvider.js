import { Capacitor, registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { browserGpsProvider } from './gpsRecorder';
import { makeNativeGpsProvider } from './nativeGpsProvider';
const plugin=registerPlugin('BackgroundGeolocation');
export const gpsProvider=Capacitor.isNativePlatform()
  ? makeNativeGpsProvider(plugin,LocalNotifications,Capacitor.getPlatform())
  : browserGpsProvider;
