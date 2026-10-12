// Adapter for the native background plugin. Dependency injection keeps lifecycle tests
// independent of a phone; the web recorder uses the same point validation and storage.
export function makeNativeGpsProvider(plugin,notifications,platform) {
  return {
    background:true,
    async start(onPosition,onError){
      if(platform==='android'){
        let permission=await notifications.checkPermissions();
        if(permission.display!=='granted')permission=await notifications.requestPermissions();
        if(permission.display!=='granted')throw new Error('Allow notifications to show that background route recording is active.');
      }
      const id=await plugin.addWatcher({
        backgroundTitle:'TripReport is recording your route',
        backgroundMessage:'Open TripReport to pause or finish recording.',
        requestPermissions:true,stale:false,distanceFilter:0,
      },(location,error)=>{
        if(error){onError(new Error(error.code==='NOT_AUTHORIZED'?'Location permission denied. Enable location access in your phone settings, then retry.':error.message||'Native GPS unavailable.'));return;}
        if(!location)return;
        onPosition({coords:{latitude:location.latitude,longitude:location.longitude,
          accuracy:location.accuracy,altitude:location.altitude,heading:location.bearing,speed:location.speed},
          timestamp:location.time});
      });
      return ()=>{void plugin.removeWatcher({id}).catch(error=>console.error('Could not remove native GPS watcher',error));};
    },
  };
}
