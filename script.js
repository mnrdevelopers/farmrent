let currentUser=null,allEquipmentData=[],selectedEquipment={},isAuthInitialized=!1,platformFeeRate=.05;const SELLER_COMMISSION_RATE=0;let customerPincode=null,availableCoins=0,coinsToApply=0;const CUSTOMER_NOTIFICATIONS_COLLECTION="customer_notifications";let lastClearTime=0,activeChatId=null,chatUnsubscribe=null,typingTimeout=null,chatBadgeUnsubscribe=null;function generateReferralCode(){return Math.random().toString(36).substring(2,10).toUpperCase()}async function lookupReferralCode(e){if(!e||8!==e.length||!window.FirebaseDB)return null;try{let t=await window.FirebaseDB.collection("users").where("referralCode","==",e).limit(1).get();if(!t.empty)return t.docs[0].id}catch(a){}return null}function getCustomerNotificationRef(e){if(!window.FirebaseDB)return null;let t="undefined"!=typeof __app_id?__app_id:"default-app-id";return window.FirebaseDB.collection("artifacts").doc(t).collection("users").doc(e).collection("customer_notifications").doc("readStatus")}async function loadLastClearTime(){if(!window.currentUser||!window.FirebaseDB){lastClearTime=0;return}try{let e=getCustomerNotificationRef(window.currentUser.uid),t=await e.get();lastClearTime=t.exists&&t.data().lastClearTime?t.data().lastClearTime.toMillis():0}catch(a){lastClearTime=0}}function getCartDocRef(e){if(!window.FirebaseDB)return null;let t="undefined"!=typeof __app_id?__app_id:"default-app-id";return window.FirebaseDB.collection("artifacts").doc(t).collection("users").doc(e).collection("cart").doc("currentCart")}async function getCartFromFirestore(){if(!window.currentUser||!window.FirebaseDB)return JSON.parse(localStorage.getItem("cart")||"[]");try{let e=getCartDocRef(window.currentUser.uid);if(!e)return[];let t=await e.get();if(t.exists)return t.data().items||[];return[]}catch(a){return JSON.parse(localStorage.getItem("cart")||"[]")}}async function updateCartInFirestore(e){if(window.currentUser&&window.FirebaseDB)try{let t=getCartDocRef(window.currentUser.uid);if(!t)return;await t.set({items:e,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:!0}),updateCartCount()}catch(a){localStorage.setItem("cart",JSON.stringify(e)),updateCartCount()}else localStorage.setItem("cart",JSON.stringify(e)),updateCartCount()}async function getPlatformFinancialSettings(){try{if(window.FirebaseDB||await new Promise(e=>{let t=setInterval(()=>{window.FirebaseDB&&(clearInterval(t),e())},100);setTimeout(()=>{clearInterval(t),e()},5e3)}),!window.FirebaseDB){platformFeeRate=.05;return}let e="undefined"!=typeof __app_id?__app_id:"default-app-id",t=window.FirebaseDB.collection("artifacts").doc(e).collection("public").doc("data").collection("settings").doc("platform"),a=await t.get();if(a.exists){let i=a.data();platformFeeRate=i.platformFee/100||.05}else platformFeeRate=.05}catch(r){platformFeeRate=.05}}async function getPostOfficeData(e){if(!window.firebaseHelpers.pincodeSystem.validatePincode(e))return[];try{let t=await window.firebaseHelpers.getPostOfficeApiUrl(),a=await fetch(`${t}${e}`);if(!a.ok)throw Error(`API returned status ${a.status}`);let i=await a.json();if(i&&i.length>0&&"Success"===i[0].Status)return i[0].PostOffice;return[]}catch(r){return[]}}async function populateLocationFields(e,t,a,i,r){let s=document.getElementById(e),n=document.getElementById(t),l=document.getElementById(a),o=document.getElementById(i),c=document.getElementById(r);if(!s||!n||!l||!o)return;n.innerHTML='<option value="">Loading...</option>',n.disabled=!0,l.value="",o.value="",c&&(c.textContent="Verifying Pincode..."),c&&c.classList.remove("text-danger","text-success","text-warning"),c&&c.classList.add("text-muted");let d=s.value;if(!window.firebaseHelpers.pincodeSystem.validatePincode(d)){n.innerHTML='<option value="">Enter Pincode Above</option>',c&&(c.textContent="");return}let u=await getPostOfficeData(d);if(u.length>0){let m=u[0];l.value=m.District||"",o.value=m.State||"",n.innerHTML='<option value="">Select your Village/Post Office *</option>';let p=[...new Set(u.map(e=>e.Name))];p.forEach(e=>{let t=document.createElement("option");t.value=e,t.textContent=e,n.appendChild(t)}),n.disabled=!1,c&&(c.textContent=`Location confirmed: ${l.value}, ${o.value}. Select your village.`,c.classList.remove("text-muted"),c.classList.add("text-success"))}else n.innerHTML='<option value="">Pincode not found or no post offices</option>',n.disabled=!0,c&&(c.textContent="Pincode not found. Please check and try again.",c.classList.remove("text-muted"),c.classList.add("text-danger"))}async function getCurrentLocationPincode(){let e=document.getElementById("location-status"),t=document.getElementById("pincode-input"),a=document.getElementById("location-access-btn");if(!navigator.geolocation){e&&(e.textContent="Geolocation is not supported by your browser.",e.classList.remove("text-muted"),e.classList.add("text-danger")),window.firebaseHelpers.showAlert("Location access is not supported. Please enter pincode manually.","warning");return}e&&(e.textContent="Requesting location permission...",e.classList.remove("text-danger","text-warning","text-success","text-info"),e.classList.add("text-muted")),a&&(a.disabled=!0,a.innerHTML='<i class="fas fa-spinner fa-spin me-2"></i> Detecting...');let i=await window.firebaseHelpers.getGeoapifyApiKey();if(!i){e&&(e.textContent="Location service temporarily unavailable.",e.classList.remove("text-muted"),e.classList.add("text-warning")),a&&(a.disabled=!1,a.innerHTML='<i class="fas fa-location-arrow me-2"></i> Use Current Location'),window.firebaseHelpers.showAlert("Location service is currently unavailable. Please enter pincode manually.","info");return}let r=async(e,t)=>{let a=`https://api.geoapify.com/v1/geocode/reverse?lat=${e}&lon=${t}&apiKey=${i}`;try{let r=await fetch(a);if(!r.ok)return null;let s=await r.json();if(s.features&&s.features.length>0&&s.features[0].properties.postcode)return s.features[0].properties.postcode;return null}catch(n){return null}};navigator.geolocation.getCurrentPosition(async i=>{let{latitude:s,longitude:n}=i.coords;e&&(e.textContent="Location found. Determining pincode...");let l=await r(s,n);l&&window.firebaseHelpers.pincodeSystem.validatePincode(l)?(e&&(e.textContent=`Location detected: ${l}`,e.classList.remove("text-muted"),e.classList.add("text-success")),t&&(t.value=l),setTimeout(async()=>{await savePincode(l),a&&(a.disabled=!1,a.innerHTML='<i class="fas fa-location-arrow me-2"></i> Use Current Location')},1e3)):(e&&(e.textContent="Could not determine Indian pincode. Please enter manually.",e.classList.remove("text-muted"),e.classList.add("text-warning")),a&&(a.disabled=!1,a.innerHTML='<i class="fas fa-location-arrow me-2"></i> Use Current Location'),window.firebaseHelpers.showAlert("Unable to detect Indian pincode. Please enter it manually.","info"))},t=>{let i="Location access denied or error occurred.";t.code===t.PERMISSION_DENIED?i="Location permission denied. Please enable location access or enter pincode manually.":t.code===t.POSITION_UNAVAILABLE?i="Location information is unavailable.":t.code===t.TIMEOUT&&(i="Location request timed out."),e&&(e.textContent=i,e.classList.remove("text-muted"),e.classList.add("text-danger")),a&&(a.disabled=!1,a.innerHTML='<i class="fas fa-location-arrow me-2"></i> Use Current Location'),window.firebaseHelpers.showAlert(i,"warning")},{enableHighAccuracy:!0,timeout:1e4,maximumAge:6e4})}async function checkAndPromptForPincode(){let e=window.firebaseHelpers.pincodeSystem.getCurrentPincode();window.customerPincode=e,updateHomepagePincodeDisplay(),updateNavbarPincodeDisplay();let t=window.location.pathname.split("/").pop();e||"index.html"!==t&&""!==t||setTimeout(()=>showPincodeModal(),500),e&&("index.html"===t||""===t||"browse.html"===t)&&loadFeaturedEquipment()}function showPincodeModal(){let e=document.getElementById("pincodeModal");if(!e)return;let t=document.getElementById("pincode-input");t&&(t.value=window.customerPincode||"");let a=document.getElementById("location-status");a&&(a.textContent="",a.className="text-muted mt-1");let i=document.getElementById("location-access-btn");i&&(i.disabled=!1,i.innerHTML='<i class="fas fa-location-arrow me-2"></i> Use Current Location'),setTimeout(renderRecentPincodes,100);let r=new bootstrap.Modal(e,{backdrop:"static",keyboard:!1});r.show();let s=document.getElementById("pincode-form");s&&!s.dataset.listener&&(s.addEventListener("submit",handlePincodeSubmit),s.dataset.listener="true"),setTimeout(()=>{t&&t.focus()},500)}async function handlePincodeSubmit(e){e.preventDefault();let t=document.getElementById("pincode-input"),a=t.value.trim();if(!window.firebaseHelpers.pincodeSystem.validatePincode(a)){window.firebaseHelpers.showAlert("Please enter a valid 6-digit Indian pincode.","danger"),t.focus(),t.select();return}let i=e.submitter,r=i.innerHTML;i.innerHTML='<i class="fas fa-spinner fa-spin me-2"></i> Checking...',i.disabled=!0;try{let s=await getPostOfficeData(a);if(0===s.length){window.firebaseHelpers.showAlert("This pincode was not found. Please check and try again.","danger"),t.focus(),t.select();return}await savePincode(a)}finally{i.innerHTML=r,i.disabled=!1}}async function savePincode(e){let t=await window.firebaseHelpers.pincodeSystem.checkPincodeCompatibility();await window.firebaseHelpers.pincodeSystem.setPincode(e),addToRecentPincodes(e);let a=await getPostOfficeData(e),i=e;a.length>0&&(i=`${a[0].District}, ${a[0].State}`),window.firebaseHelpers.showAlert(`Location set to ${i}. Showing local equipment.`,"success"),updateHomepagePincodeDisplay(),updateNavbarPincodeDisplay();let r=window.location.pathname.split("/").pop();"browse.html"===r?(updatePincodeDisplay(),loadAllEquipment()):"cart.html"===r?loadCartPage():"checkout.html"===r?loadCheckoutPage():loadFeaturedEquipment(),t.changed&&!t.allItemsCompatible&&window.firebaseHelpers.pincodeSystem.showPincodeChangeWarning(t);let s=bootstrap.Modal.getInstance(document.getElementById("pincodeModal"));s&&s.hide()}function skipPincode(){window.firebaseHelpers.pincodeSystem.clearPincode();let e=bootstrap.Modal.getInstance(document.getElementById("pincodeModal"));e&&e.hide(),window.firebaseHelpers.showAlert("Viewing equipment from all locations. Set your pincode to see local availability.","info"),updateHomepagePincodeDisplay(),updateNavbarPincodeDisplay();let t=window.location.pathname.split("/").pop();"browse.html"===t?(updatePincodeDisplay(),loadAllEquipment()):loadFeaturedEquipment()}function updateHomepagePincodeDisplay(){let e=document.getElementById("current-pincode-value"),t=document.getElementById("homepage-pincode-display"),a=window.customerPincode;if(e&&(e.textContent=a||"All Locations"),t){let i=t.querySelector("p strong");i&&(i.textContent=a||"All Locations");let r=t.querySelector("button");r&&(a?r.innerHTML='<i class="fas fa-map-marker-alt me-1"></i> Change Location':r.innerHTML='<i class="fas fa-map-marker-alt me-1"></i> Set Your Location')}}function updateNavbarPincodeDisplay(){let e=document.getElementById("current-pincode-value-nav");if(e){let t=window.customerPincode;t?(e.textContent=t,e.parentElement.title="Click to change location"):(e.textContent="Set Location",e.parentElement.title="Click to set your location")}}async function updateCartForNewPincode(){let e=`
        <div class="modal fade" id="confirm-clear-cart-modal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header bg-danger text-white">
                        <h5 class="modal-title"><i class="fas fa-trash me-2"></i>Confirm Clear Cart</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <p>Are you sure you want to clear your cart? This action is permanent and will allow you to shop in your new location.</p>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                        <button type="button" class="btn btn-danger" id="confirm-clear-cart-btn">Clear Cart</button>
                    </div>
                </div>
            </div>
        </div>
    `;document.body.insertAdjacentHTML("beforeend",e);let t=document.getElementById("confirm-clear-cart-modal"),a=new bootstrap.Modal(t);a.show(),document.getElementById("confirm-clear-cart-btn").onclick=async()=>{a.hide(),await updateCartInFirestore([]),window.firebaseHelpers.showAlert("Cart cleared. Showing equipment for your new location.","success");let e=window.location.pathname.split("/").pop();"cart.html"===e?loadCartPage():"browse.html"===e&&loadAllEquipment(),t.remove()}}async function revertToPreviousPincode(){let e=localStorage.getItem("previousPincode");if(e){await savePincode(e),localStorage.removeItem("previousPincode");let t=document.getElementById("custom-warning-modal");if(t){let a=bootstrap.Modal.getInstance(t);a&&a.hide()}}}async function changePincodeToMatchEquipment(e){await savePincode(e);let t=document.getElementById("custom-warning-modal");if(t){let a=bootstrap.Modal.getInstance(t);a&&a.hide()}setTimeout(()=>{window.firebaseHelpers.showAlert('Location updated. Please click "Add to Cart" or "Rent Now" again.',"info")},500)}function showCustomWarningModal(e){let t=document.getElementById("custom-warning-modal");t&&t.remove();let a=`
        <div class="modal fade" id="custom-warning-modal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header bg-warning text-dark">
                        <h5 class="modal-title"><i class="fas fa-exclamation-triangle me-2"></i>Attention Required</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        ${e}
                    </div>
                </div>
            </div>
        </div>
    `;document.body.insertAdjacentHTML("beforeend",a),setTimeout(()=>{let e=document.getElementById("custom-warning-modal");if(e){let t=new bootstrap.Modal(e);t.show()}},0)}function initializeAuth(){if(window.firebaseHelpers&&window.FirebaseDB&&window.FirebaseAuth)initializeAuthInternal();else{let e=setInterval(()=>{window.firebaseHelpers&&window.FirebaseDB&&window.FirebaseAuth&&(clearInterval(e),initializeAuthInternal())},100);setTimeout(()=>{isAuthInitialized||(isAuthInitialized=!0,updateNavbarForLoggedOutUser())},1e4)}return new Promise(e=>{let t=setInterval(()=>{isAuthInitialized&&(clearInterval(t),e())},100)})}async function initializeAuthInternal(){try{window.FirebaseAuth.onAuthStateChanged(async e=>{if(e)try{let t=window.FirebaseDB.collection("users").doc(e.uid),a=await t.get();if(a.exists){window.currentUser={uid:e.uid,...a.data()};let i=window.currentUser,r=!1;void 0===i.coins&&(i.coins=0,r=!0),void 0===i.referralCode&&(i.referralCode=generateReferralCode(),r=!0),void 0===i.firstOrderPlaced&&(i.firstOrderPlaced=!1,r=!0),r&&(await t.set({coins:i.coins,referralCode:i.referralCode,firstOrderPlaced:i.firstOrderPlaced},{merge:!0}),window.currentUser={uid:e.uid,...a.data(),...i}),availableCoins=window.currentUser.coins,window.customerPincode=window.currentUser.pincode||localStorage.getItem("customerPincode")||null,await loadLastClearTime(),updateNavbarForLoggedInUser(window.currentUser),updateCartCount(),document.getElementById("chat-body")&&loadUserConversations();let s=window.location.pathname.split("/").pop();"browse.html"===s?(updatePincodeDisplay(),loadAllEquipment()):("index.html"===s||""===s)&&(updateHomepagePincodeDisplay(),loadFeaturedEquipment()),updateNavbarPincodeDisplay(),listenForUnreadChatMessages()}else await window.firebaseHelpers.signOut(),window.location.reload()}catch(n){await window.firebaseHelpers.signOut(),window.location.reload()}finally{isAuthInitialized=!0}else{window.currentUser=null,window.customerPincode=localStorage.getItem("customerPincode")||null,lastClearTime=0,updateNavbarForLoggedOutUser(),updateCartCount(),isAuthInitialized=!0;let l=window.location.pathname.split("/").pop();"browse.html"===l?(updatePincodeDisplay(),loadAllEquipment()):("index.html"===l||""===l)&&(updateHomepagePincodeDisplay(),loadFeaturedEquipment()),updateNavbarPincodeDisplay(),availableCoins=0,coinsToApply=0,chatBadgeUnsubscribe&&(chatBadgeUnsubscribe(),chatBadgeUnsubscribe=null),updateChatBadgeCount(0)}})}catch(e){isAuthInitialized=!0}}async function logout(){try{window.firebaseHelpers.pincodeSystem.clearPincode(),window.customerPincode=null,lastClearTime=0,availableCoins=0,coinsToApply=0,chatBadgeUnsubscribe&&(chatBadgeUnsubscribe(),chatBadgeUnsubscribe=null),await window.firebaseHelpers.signOut(),window.location.reload()}catch(e){window.firebaseHelpers.showAlert("Error logging out","danger")}}async function loadBrowsePageData(){window.customerPincode=window.firebaseHelpers.pincodeSystem.getCurrentPincode(),await updatePincodeDisplay(),await loadAllEquipment(),await loadCategoriesForFilter(),await updateCartCount();let e=window.location.hash.substring(1),t=e.match(/item=([^&]+)/);if(t){let a=t[1];showEquipmentDetailsModal(a),window.history.replaceState(null,null," ")}}async function updatePincodeDisplay(){let e=document.getElementById("pincode-alert-container");if(!e)return;let t=window.customerPincode;if(t){let a=t;try{let i=await getPostOfficeData(t);i.length>0&&(a=`${i[0].District}, ${i[0].State} (${t})`)}catch(r){}e.innerHTML=`
            <div class="alert alert-success d-flex justify-content-between align-items-center mb-0">
                <div>
                    <i class="fas fa-map-marker-alt me-2"></i>
                    <strong>Location:</strong> ${a}
                    <small class="d-block text-muted">Showing equipment available in your area</small>
                </div>
                <a href="#" class="btn btn-sm btn-outline-success" onclick="showPincodeModal()">Change</a>
            </div>
        `}else e.innerHTML=`
            <div class="alert alert-warning d-flex justify-content-between align-items-center mb-0">
                <div>
                    <i class="fas fa-map-marker-alt me-2"></i>
                    <strong>Location Not Set</strong> - Showing equipment from all locations
                </div>
                <a href="#" class="btn btn-sm btn-outline-warning text-dark" onclick="showPincodeModal()">Set Your Location</a>
            </div>
        `}async function loadAllEquipment(){try{let e=document.getElementById("equipment-grid");e&&(e.innerHTML='<div class="col-12 text-center py-5"><div class="spinner-border text-primary loading-spinner"></div><p class="mt-3">Loading equipment listings...</p></div>');let t=window.FirebaseDB.collection("equipment").where("status","==","approved"),a=window.firebaseHelpers.pincodeSystem.getCurrentPincode();a&&(t=t.where("pincode","==",a));let i=await t.orderBy("createdAt","desc").get();allEquipmentData=[],i.forEach(e=>{allEquipmentData.push({id:e.id,...e.data()})}),filterEquipment()}catch(r){let s=document.getElementById("equipment-grid");s&&(s.innerHTML='<div class="col-12 text-center py-5 text-danger"><p>Error loading equipment listings. Please try again later.</p></div>')}}async function loadFeaturedEquipment(){try{let e=document.getElementById("featured-equipment");if(!e)return;e.innerHTML='<div class="col-12 text-center py-5"><div class="spinner-border text-primary loading-spinner"></div><p class="mt-3">Loading popular equipment...</p></div>';let t=window.FirebaseDB.collection("equipment").where("status","==","approved"),a=window.firebaseHelpers.pincodeSystem.getCurrentPincode();a&&(t=t.where("pincode","==",a));let i=await t.where("featured","==",!0).limit(6).get(),r=[];if(i.forEach(e=>{r.push({id:e.id,...e.data()})}),0===r.length&&a){e.innerHTML=`
                <div class="col-12 text-center py-5">
                    <i class="fas fa-map-marker-alt fa-3x text-muted mb-3"></i>
                    <h4>No Equipment Found for Pincode ${a}</h4>
                    <p class="text-muted">Try changing your location or removing the filter to view general listings.</p>
                    <button class="btn btn-primary mt-3" onclick="showPincodeModal()">
                        <i class="fas fa-map-marker-alt me-2"></i>Change Location
                    </button>
                    <button class="btn btn-outline-secondary mt-3 ms-2" onclick="skipPincode()">
                        <i class="fas fa-globe me-2"></i>View All Listings
                    </button>
                </div>
            `;return}if(r.length<6){let s=r.map(e=>e.id),n=6-r.length,l=window.FirebaseDB.collection("equipment").where("status","==","approved").orderBy("createdAt","desc").limit(2*n);a&&(l=l.where("pincode","==",a));(await l.get()).forEach(e=>{let t={id:e.id,...e.data()};!s.includes(t.id)&&r.length<6&&r.push(t)}),r=r.slice(0,6)}if(e.innerHTML="",0===r.length){let o=a?` for Pincode ${a}`:"";e.innerHTML=`<div class="col-12 text-center py-5"><p>No equipment available to display right now${o}. Try changing your location filter or checking back later.</p></div>`;return}r.forEach(t=>{let a=document.createElement("div");a.className="col-lg-4 col-md-6 mb-4",a.innerHTML=createEquipmentCard(t,t.id),e.appendChild(a)})}catch(c){let d=document.getElementById("featured-equipment");d&&(d.innerHTML='<div class="col-12 text-center py-5 text-danger"><p>Error loading equipment. Please try again later.</p></div>')}}function createEquipmentCard(e,t,a=!1){let i=e.images&&e.images[0]?e.images[0]:"https://placehold.co/300x200/2B5C2B/FFFFFF?text=Equipment",r=window.firebaseHelpers.pincodeSystem.getCurrentPincode(),s=e.pincode,n=!r||s===r,l=!n&&r?`
        <div class="alert alert-warning p-2 mt-2 mb-2 small">
            <i class="fas fa-exclamation-triangle me-1"></i>
            <small>Located in ${s} (Your filter: ${r})</small>
        </div>
    `:"",o=`card equipment-card h-100 ${!n&&r?"border-warning":""}`,c=a?`<button class="btn btn-primary w-100" onclick="showEquipmentDetailsModal('${t}')">View Details</button>`:`<a href="item.html?id=${t}" class="btn btn-primary w-100">View Details</a>`,d=getStarRatingHtml(e.rating||0);return`
        <div class="${o}">
            ${!n&&r?'<div class="card-header bg-warning text-dark small py-1"><i class="fas fa-map-marker-alt me-1"></i>Different Location</div>':""}
            <div class="position-relative">
                <img src="${i}" class="card-img-top" alt="${e.name}" style="height: 200px; object-fit: cover;">
                <span class="category-badge">${e.category||"Equipment"}</span>
                ${e.onSale||e.featured?'<span class="sale-badge position-absolute" style="top:15px; left:15px;">'+(e.featured?"Featured":"Special Offer")+"</span>":""}
            </div>
            <div class="card-body d-flex flex-column">
                <h5 class="card-title">${e.name}</h5>
                ${d}
                ${l}
                <div class="mt-auto">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <div class="price-tag">₹${e.pricePerAcre||0}/acre</div>
                        <small class="text-muted">or ₹${e.pricePerHour||0}/hour</small>
                    </div>
                    <p class="mb-2 small text-muted"><i class="fas fa-map-marker-alt me-1"></i> Pincode: ${e.pincode||"N/A"}</p>
                    ${c}
                </div>
            </div>
        </div>
    `}async function getSellerInfo(e){try{let t=await window.FirebaseDB.collection("users").doc(e).get();if(t.exists&&"seller"===t.data().role)return t.data();return null}catch(a){return null}}async function showEquipmentDetailsModal(e){try{let t=allEquipmentData.find(t=>t.id===e);if(!t){let a=await window.FirebaseDB.collection("equipment").doc(e).get();if(a.exists)t={id:a.id,...a.data()};else{window.firebaseHelpers.showAlert("Equipment details not found.","danger");return}}selectedEquipment=t;let i=await getSellerInfo(selectedEquipment.sellerId);selectedEquipment.sellerDetails=i,document.getElementById("equipmentModalTitle").textContent=selectedEquipment.name,document.getElementById("modal-content-area").innerHTML=buildModalContent(selectedEquipment,i);let r=document.getElementById("add-to-cart-btn");r&&(r.onclick=()=>addToCartModal());let s=document.getElementById("rent-now-btn");s&&(s.onclick=()=>rentNowModal());let n=document.getElementById("rental-duration-type"),l=document.getElementById("rental-duration-value");n&&l?(updateModalPrice(n.value,l.value),n.onchange=()=>updateModalPrice(n.value,l.value),l.oninput=()=>updateModalPrice(n.value,l.value)):selectedEquipment.rentalDetails={durationType:"acre",durationValue:1,calculatedPrice:selectedEquipment.pricePerAcre||0,pickupDate:null,pickupTime:null};let o=document.getElementById("pickup-date");if(o){let c=new Date().toISOString().split("T")[0];o.min=c,o.onchange=()=>updateRentalDetails()}let d=document.getElementById("pickup-time");d&&(d.onchange=()=>updateRentalDetails()),updateRentalDetails();let u=new bootstrap.Modal(document.getElementById("equipmentDetailsModal"));u.show()}catch(m){window.firebaseHelpers.showAlert("Could not load equipment details.","danger")}}function updateRentalDetails(){let e=document.getElementById("rental-duration-type")?.value,t=parseInt(document.getElementById("rental-duration-value")?.value)||0,a=("acre"===e?selectedEquipment.pricePerAcre||0:selectedEquipment.pricePerHour||0)*t;selectedEquipment.rentalDetails={durationType:e,durationValue:t,calculatedPrice:a,pickupDate:document.getElementById("pickup-date")?.value||null,pickupTime:document.getElementById("pickup-time")?.value||null},updateModalPrice(e,t)}function buildModalContent(e,t){let a=e.images&&e.images[0]?e.images[0]:"https://placehold.co/500x300/2B5C2B/FFFFFF?text=Equipment",i=e.availability?"Available Now":"Currently Rented",r=e.availability?"bg-success":"bg-danger",s=t?.name||e.sellerName||"Seller User",n=t?.businessName||e.businessName||"N/A",l=t?`${t.address||"Seller Address Missing"}, ${t.village||""}, ${t.city||""}, ${t.state||""}`:"Address details are missing. Contact Seller.";return`
        <div class="row">
            <div class="col-md-6">
                <img src="${a}" class="img-fluid rounded mb-3" alt="${e.name}" style="height: 300px; width: 100%; object-fit: cover;">
                ${e.images&&e.images.length>1?`
                    <div class="d-flex gap-2 mb-3 overflow-auto">
                        ${e.images.slice(1).map(e=>`
                            <img src="${e}" class="img-thumbnail" style="width: 80px; height: 80px; object-fit: cover;">
                        `).join("")}
                    </div>
                `:""}
                <h5 class="mt-4 text-warning"><i class="fas fa-user-tie me-2"></i>Seller Information</h5>
                <ul class="list-unstyled">
                    <li><strong>Business:</strong> ${n}</li>
                    <li><strong>Contact Person:</strong> ${s}</li>
                    <li><i class="fas fa-map-marker-alt me-2 text-danger"></i> <strong>Pickup Pincode:</strong> ${e.pincode||"N/A"}</li>
                </ul>
                <h5 class="mt-4 text-warning"><i class="fas fa-map-marked-alt me-2"></i>Clear Pickup Address</h5>
                <div class="alert alert-light border small">
                    <strong>Full Address:</strong> ${l}
                </div>
            </div>
            <div class="col-md-6">
                <div class="d-flex justify-content-between align-items-center mb-3">
                    <span class="badge ${r} text-white p-2">${i}</span>
                    <span class="text-muted small">Listed by: <strong>${n}</strong></span>
                </div>
                <h3 class="text-primary mb-3">${window.firebaseHelpers.formatCurrency(e.pricePerAcre)}/Acre | ${window.firebaseHelpers.formatCurrency(e.pricePerHour)}/Hour</h3>
                <p>${e.description}</p>
                <ul class="list-unstyled">
                    <li><i class="fas fa-tags me-2 text-warning"></i> <strong>Category:</strong> ${e.category}</li>
                    <li><i class="fas fa-list-ol me-2 text-warning"></i> <strong>Quantity:</strong> ${e.quantity}</li>
                </ul>
                ${e.specifications&&Object.keys(e.specifications).length>0?`
                    <h5 class="mt-4">Specifications (Item Info)</h5>
                    <div class="row">
                        ${Object.entries(e.specifications).map(([e,t])=>`
                            <div class="col-6 mb-2"><strong>${e}:</strong> ${t}</div>
                        `).join("")}
                    </div>
                `:""}
            </div>
        </div>
    `}function updateModalPrice(e,t){let a=parseInt(t),i=document.getElementById("modal-total-price");if(isNaN(a)||a<=0){i&&(i.textContent="₹0"),updateRentalDetails();return}let r=0;r="acre"===e?(selectedEquipment.pricePerAcre||0)*a:(selectedEquipment.pricePerHour||0)*a,selectedEquipment.rentalDetails={...selectedEquipment.rentalDetails,calculatedPrice:r},i&&(i.textContent=window.firebaseHelpers.formatCurrency(r))}async function addToCartModal(){updateRentalDetails();let e=selectedEquipment,t=e.rentalDetails;if(!t||t.calculatedPrice<=0||!e.id||!t.durationType){window.firebaseHelpers.showAlert("Please select a valid rental duration.","warning");return}if(!t.pickupDate||!t.pickupTime){window.firebaseHelpers.showAlert("Please select the required **Pickup Date and Time**.","danger");return}let{durationType:a,durationValue:i,calculatedPrice:r,pickupDate:s,pickupTime:n}=t,l=await getCartFromFirestore(),o=e.pincode;if(!o){window.firebaseHelpers.showAlert("Equipment missing Pincode information. Cannot add to cart.","danger");return}let c=window.firebaseHelpers.pincodeSystem.getCurrentPincode();if(!c){window.firebaseHelpers.showAlert("Please set your location first to ensure equipment availability.","warning"),showPincodeModal();return}if(o!==c){let d=`
            <div class="alert alert-warning">
                <h6><i class="fas fa-map-marker-alt me-2"></i>Location Mismatch</h6>
                <p>This equipment is located in Pincode <strong>${o}</strong>, 
                but your current location filter is <strong>${c}</strong>.</p>
                <p class="mb-2"><small>Items must match your active location filter to proceed to checkout.</small></p>
                <div class="d-flex gap-2 mt-2">
                    <button class="btn btn-sm btn-warning" onclick="changePincodeToMatchEquipment('${o}')">
                        Change My Location to ${o} & Continue
                    </button>
                    <button class="btn btn-sm btn-outline-secondary" onclick="bootstrap.Modal.getInstance(document.getElementById('custom-warning-modal')).hide();">
                        Cancel
                    </button>
                </div>
            </div>
        `;showCustomWarningModal(d);return}if(l.length>0){let u=l[0].pincode;if(u&&u!==c){window.firebaseHelpers.showAlert(`Cannot add equipment from Pincode ${o}. Your cart contains items from ${u}. Clear your cart to order from a different Pincode.`,"danger");return}}let m={id:e.id,name:e.name,sellerId:e.sellerId,businessName:e.businessName,price:r,pricePerAcre:e.pricePerAcre,pricePerHour:e.pricePerHour,rentalType:a,rentalValue:i,imageUrl:e.images&&e.images[0],pincode:o,pickupDate:s,pickupTime:n,sellerAddress:e.sellerDetails?`${e.sellerDetails.address}, ${e.sellerDetails.village}, ${e.sellerDetails.city}, ${e.sellerDetails.state}`:"Address Unavailable"},p=l.findIndex(t=>t.id===e.id);p>-1?l[p]=m:l.push(m),await updateCartInFirestore(l);let f=bootstrap.Modal.getInstance(document.getElementById("equipmentDetailsModal"));f&&f.hide(),window.firebaseHelpers.showAlert(`${e.name} added to cart!`,"success")}async function rentNowModal(){updateRentalDetails();let e=selectedEquipment,t=e.rentalDetails;if(!t||t.calculatedPrice<=0||!e.id){window.firebaseHelpers.showAlert("Please select a valid rental duration.","warning");return}if(!t.pickupDate||!t.pickupTime){window.firebaseHelpers.showAlert("Please select the required **Pickup Date and Time**.","danger");return}let{calculatedPrice:a,pickupDate:i,pickupTime:r}=t,s=e.pincode;if(!s){window.firebaseHelpers.showAlert("Equipment missing Pincode information. Cannot proceed to checkout.","danger");return}let n=window.firebaseHelpers.pincodeSystem.getCurrentPincode();if(!n){window.firebaseHelpers.showAlert("Location required! Please set your Pincode before proceeding to rent.","danger"),showPincodeModal();return}if(n!==s){window.firebaseHelpers.showAlert(`The selected equipment is in Pincode ${s}, but your current location filter is set to ${n}. Please resolve the location mismatch.`,"danger");let l=`
            <div class="alert alert-danger">
                <h6><i class="fas fa-map-marker-alt me-2"></i>Checkout Blocked: Location Mismatch</h6>
                <p>This equipment is located in Pincode <strong>${s}</strong>, 
                but your current location filter is <strong>${n}</strong>.</p>
                <p class="mb-2"><small>You must set your location to match the equipment location to rent now.</small></p>
                <div class="d-flex gap-2 mt-2">
                    <button class="btn btn-sm btn-warning" onclick="changePincodeToMatchEquipment('${s}'); window.location.href='checkout.html'">
                        Change My Location to ${s} & Checkout
                    </button>
                    <button type="button" class="btn btn-sm btn-outline-secondary" onclick="bootstrap.Modal.getInstance(document.getElementById('custom-warning-modal')).hide();">
                        Cancel
                    </button>
                </div>
            </div>
        `;showCustomWarningModal(l);return}let o=[{id:e.id,name:e.name,sellerId:e.sellerId,businessName:e.businessName,price:a,pricePerAcre:e.pricePerAcre,pricePerHour:e.pricePerHour,rentalType:t.durationType,rentalValue:t.durationValue,imageUrl:e.images&&e.images[0],pincode:s,pickupDate:i,pickupTime:r,sellerAddress:e.sellerDetails?`${e.sellerDetails.address}, ${e.sellerDetails.village}, ${e.sellerDetails.city}, ${e.sellerDetails.state}`:"Address Unavailable"}];await updateCartInFirestore(o);let c=bootstrap.Modal.getInstance(document.getElementById("equipmentDetailsModal"));c&&c.hide(),window.location.href="checkout.html"}async function loadCartPage(){await new Promise(e=>{let t=setInterval(()=>{isAuthInitialized&&(clearInterval(t),e())},100)}),await getPlatformFinancialSettings();let e=await getCartFromFirestore();await checkCartPincodeCompatibility(e),displayCartItems(e)}async function checkCartPincodeCompatibility(e){let t=document.getElementById("cart-pincode-warning"),a=document.getElementById("checkout-btn");if(!t||!a||(t.innerHTML="",a.disabled=!1,0===e.length))return;let i=window.firebaseHelpers.pincodeSystem.getCurrentPincode(),r={};e.forEach(e=>{let t=e.pincode||"Unknown";r[t]||(r[t]=[]),r[t].push(e)});let s=Object.keys(r).filter(e=>"Unknown"!==e);if(s.length>1){t.innerHTML=`
            <div class="alert alert-danger">
                <h6><i class="fas fa-exclamation-circle me-2"></i>Cart Contains Mixed Locations</h6>
                <p>Your cart has equipment from different locations:</p>
                <ul class="mb-2">
                    ${s.map(e=>`<li>${r[e].length} item(s) from Pincode ${e}</li>`).join("")}
                </ul>
                <p><strong>You can only checkout items from one location at a time.</strong></p>
                <button class="btn btn-sm btn-danger" onclick="resolveMixedPincodeCart()">
                    <i class="fas fa-sync-alt me-1"></i>Resolve Location Conflict
                </button>
            </div>
        `,a.disabled=!0;return}let n=s[0];if(n&&i&&n!==i){t.innerHTML=`
            <div class="alert alert-warning">
                <h6><i class="fas fa-map-marker-alt me-2"></i>Location Mismatch</h6>
                <p>Your cart items are from <strong>Pincode ${n}</strong>, 
                but your current location filter is <strong>${i}</strong>.</p>
                <div class="d-flex gap-2 mt-2">
                    <button class="btn btn-sm btn-warning" onclick="changePincodeToMatchCart('${n}')">
                        Change My Location to ${n}
                    </button>
                    <button class="btn btn-sm btn-outline-danger" onclick="clearCartForCurrentLocation()">
                        Clear Cart & Shop in ${i}
                    </button>
                </div>
            </div>
        `,a.disabled=!0;return}if(n&&!i){t.innerHTML=`
            <div class="alert alert-info">
                <h6><i class="fas fa-info-circle me-2"></i>Location Required</h6>
                <p>Your cart is for <strong>Pincode ${n}</strong>. Please set your location to match to proceed.</p>
                <button class="btn btn-sm btn-primary" onclick="showPincodeModal()">
                    <i class="fas fa-map-marker-alt me-1"></i>Set Location
                </button>
            </div>
        `,a.disabled=!0;return}if(!n&&e.length>0){t.innerHTML=`
            <div class="alert alert-danger">
                <h6><i class="fas fa-exclamation-circle me-2"></i>Data Error</h6>
                <p>Some items in your cart are missing location data. Please remove and re-add them.</p>
            </div>
        `,a.disabled=!0;return}}async function resolveMixedPincodeCart(){let e=await getCartFromFirestore(),t={};e.forEach(e=>{let a=e.pincode||"Unknown";t[a]||(t[a]=[]),t[a].push(e)});let a=Object.entries(t).map(([e,t])=>`
        <div class="form-check mb-2">
            <input class="form-check-input" type="radio" name="selectedPincode" 
                    id="pincode-${e}" value="${e}">
            <label class="form-check-label" for="pincode-${e}">
                <strong>Pincode ${e}</strong> - ${t.length} item(s)
                <br><small>${t.map(e=>e.name).join(", ")}</small>
            </label>
        </div>
    `).join(""),i=`
        <h5>Resolve Location Conflict</h5>
        <p>Your cart contains items from multiple locations. Please choose which location to keep:</p>
        <div id="pincode-options" class="my-3">
            ${a}
        </div>
        <div class="alert alert-info">
            <i class="fas fa-info-circle me-2"></i>
            Items from other locations will be removed from your cart. Your current location filter will be updated to match your choice.
        </div>
        <div class="modal-footer justify-content-between">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" id="confirm-pincode-choice">
                Keep Selected Location
            </button>
        </div>
    `;showCustomWarningModal(i),setTimeout(()=>{let t=document.getElementById("confirm-pincode-choice");t&&(t.onclick=async()=>{let t=document.querySelector('input[name="selectedPincode"]:checked');if(t){let a=t.value,i=e.filter(e=>e.pincode===a);await updateCartInFirestore(i),await savePincode(a),loadCartPage();let r=bootstrap.Modal.getInstance(document.getElementById("custom-warning-modal"));r&&r.hide()}else window.firebaseHelpers.showAlert("Please select a pincode to resolve the conflict.","warning")})},100)}async function changePincodeToMatchCart(e){await savePincode(e),loadCartPage()}async function clearCartForCurrentLocation(){await updateCartForNewPincode(),loadCartPage()}async function startCheckout(){if(!window.currentUser){window.firebaseHelpers.showAlert("Please log in before proceeding to checkout.","warning"),setTimeout(()=>{window.location.href="customer-auth.html"},1500);return}let e=window.firebaseHelpers.pincodeSystem.getCurrentPincode(),t=await getCartFromFirestore();if(0===t.length){window.firebaseHelpers.showAlert("Your cart is empty. Please add items to proceed.","warning"),setTimeout(()=>{window.location.href="browse.html"},2e3);return}let a=t.some(e=>!e.pickupDate||!e.pickupTime);if(a){window.firebaseHelpers.showAlert("Please set the required **Pickup Date and Time** for all items in your cart.","danger");return}if(!e){window.firebaseHelpers.showAlert("Location required! Please set your Pincode to finalize the rental location.","danger"),showPincodeModal();return}let i=t[0]?.pincode;if(i!==e){window.firebaseHelpers.showAlert(`Your cart items are from Pincode ${i}, but your current Pincode is ${e}. Please resolve the location mismatch in your cart.`,"danger"),setTimeout(()=>{window.location.href="cart.html"},1500);return}window.location.href="checkout.html"}async function loadCheckoutPage(){await new Promise(e=>{let t=setInterval(()=>{isAuthInitialized&&(clearInterval(t),e())},100)}),await getPlatformFinancialSettings();let e=await window.firebaseHelpers.getCurrentUser(),t=await getCartFromFirestore();if(!e||0===t.length){e?(window.firebaseHelpers.showAlert("Your cart is empty. Please add items to proceed.","warning"),setTimeout(()=>{window.location.href="browse.html"},2e3)):(window.firebaseHelpers.showAlert("You must be logged in to checkout.","danger"),setTimeout(()=>{window.location.href="customer-auth.html"},2e3));return}try{let a=await window.FirebaseDB.collection("users").doc(e.uid).get();if(a.exists){let i=a.data();window.currentUser={uid:e.uid,email:e.email,...i},availableCoins=i.coins||0}}catch(r){availableCoins=window.currentUser?.coins||0}let s=window.firebaseHelpers.pincodeSystem.getCurrentPincode(),n=document.querySelector(".checkout-summary");if(!s||t[0].pincode!==s){let l="Location Mismatch: ";s?l+=`Cart items (${t[0].pincode}) don't match your location (${s}).`:l+="Please set your location.";let o=`
            <div class="alert alert-danger p-4">
                <h6><i class="fas fa-exclamation-triangle me-2"></i>Checkout Blocked</h6>
                <p>${l}</p>
                <div class="d-flex gap-2 mt-3">
                    ${s?`
                        <button class="btn btn-sm btn-warning" onclick="changePincodeToMatchCart('${t[0].pincode}')">
                            Change Location to ${t[0].pincode}
                        </button>
                    `:`
                        <button class="btn btn-sm btn-primary" onclick="showPincodeModal()">
                            <i class="fas fa-map-marker-alt me-2"></i>Set Location Now
                        </button>
                    `}
                    <button class="btn btn-sm btn-outline-secondary" onclick="window.location.href='cart.html'">
                        <i class="fas fa-shopping-cart me-2"></i>Back to Cart
                    </button>
                </div>
            </div>
        `;n&&(n.innerHTML=o);let c=document.getElementById("pay-now-btn");c&&(c.disabled=!0);let d=document.getElementById("pay-button-amount");d&&(d.textContent="Error");return}let u=document.getElementById("customer-name");u&&(u.value=window.currentUser?.name||"");let m=document.getElementById("customer-email");m&&(m.value=window.currentUser?.email||"");let p=document.getElementById("customer-phone");p&&(p.value=window.currentUser?.mobile||"");let f=document.getElementById("coin-balance-display");if(f&&(f.textContent=`${availableCoins||0} Coins`),window.razorpayContext={items:t,orderPickupDate:t[0]?.pickupDate,orderPickupTime:t[0]?.pickupTime,orderPincode:t[0]?.pincode||"N/A"},window.currentUser&&!window.currentUser.firstOrderPlaced&&0===coinsToApply){let g=0;t.forEach(e=>{g+=e.price});let h=Math.floor(.5*g),b=availableCoins||0;coinsToApply=Math.min(50,b,h);let y=document.getElementById("coins-to-apply");y&&(y.value=coinsToApply)}displayCheckoutSummary(t)}function updateNavbarForLoggedInUser(e){let t=document.getElementById("navbar-auth");if(!t)return;let a="";"customer"===e.role&&(a=`
            <li class="nav-item dropdown">
                <a class="nav-link dropdown-toggle" href="#" id="notificationDropdown" role="button" data-bs-toggle="dropdown" aria-expanded="false">
                    <i class="fas fa-bell"></i>
                    <span class="badge bg-danger position-absolute top-0 start-100 translate-middle rounded-pill" id="customer-notification-count">0</span>
                </a>
                <ul class="dropdown-menu dropdown-menu-end" aria-labelledby="notificationDropdown" id="customer-notifications-list">
                    <li><h6 class="dropdown-header">Alerts & Updates</h6></li>
                    <li><a class="dropdown-item text-center text-muted" href="#" onclick="showSection('orders')">Loading...</a></li>
                    <li><hr class="dropdown-divider"></li>
                    <li><a class="dropdown-item text-center text-primary small" href="#" onclick="markCustomerNotificationsAsRead()">
                        <i class="fas fa-check-double me-1"></i> Clear Alerts
                    </a></li>
                </ul>
            </li>
        `,checkCustomerNotifications());let i=`
        ${a}
        <li class="nav-item dropdown">
            <a class="nav-link dropdown-toggle" href="#" id="userDropdown" role="button" data-bs-toggle="dropdown">
                <i class="fas fa-user-circle me-1"></i> ${e.name||"User"}
            </a>
            <ul class="dropdown-menu">
                <li><a class="dropdown-item" href="profile.html"><i class="fas fa-user me-2"></i>Profile</a></li>
                <li><a class="dropdown-item" href="orders.html"><i class="fas fa-clipboard-list me-2"></i>My Orders</a></li>
    `;"seller"===e.role&&(i+='<li><a class="dropdown-item" href="seller.html"><i class="fas fa-store me-2"></i>Seller Dashboard</a></li>'),"admin"===e.role&&(i+='<li><a class="dropdown-item" href="admin.html"><i class="fas fa-user-shield me-2"></i>Admin Panel</a></li>'),i+=`
                <li><hr class="dropdown-divider"></li>
                <li><a class="dropdown-item" href="#" onclick="logout()"><i class="fas fa-sign-out-alt me-2"></i>Logout</a></li>
            </ul>
        </li>
    `,t.innerHTML="",t.insertAdjacentHTML("afterbegin",i)}async function markCustomerNotificationsAsRead(){if(window.currentUser&&window.FirebaseDB&&"customer"===window.currentUser.role)try{let e=getCustomerNotificationRef(window.currentUser.uid);await e.set({lastClearTime:firebase.firestore.FieldValue.serverTimestamp()},{merge:!0}),lastClearTime=Date.now();let t=document.getElementById("customer-notification-count");t&&(t.textContent="");let a=document.getElementById("customer-notifications-list");a&&(a.innerHTML='<li><h6 class="dropdown-header">Alerts & Updates</h6></li><li><a class="dropdown-item text-center text-muted" href="#">All caught up! (Database Updated)</a></li><li><hr class="dropdown-divider"></li><li><a class="dropdown-item text-center" href="orders.html">View All Orders</a></li><li><hr class="dropdown-divider"></li><li><a class="dropdown-item text-center text-primary small" href="#" onclick="markCustomerNotificationsAsRead()"><i class="fas fa-check-double me-1"></i> Clear Alerts</a></li>');let i=document.getElementById("notificationDropdown"),r=bootstrap.Dropdown.getInstance(i);r&&r.hide(),window.firebaseHelpers.showAlert("Notifications cleared and status saved to database.","success")}catch(s){window.firebaseHelpers.showAlert("Failed to save read status. Please try again.","danger")}}async function checkCustomerNotifications(){if(window.currentUser&&"customer"===window.currentUser.role&&window.FirebaseDB)try{await loadLastClearTime();let e="undefined"!=typeof __app_id?__app_id:"default-app-id",t=window.FirebaseDB.collection("artifacts").doc(e).collection("public").doc("data").collection("orders"),a=await t.where("userId","==",window.currentUser.uid).orderBy("updatedAt","desc").limit(10).get(),i=[],r=0,s=0,n=lastClearTime;a.forEach(e=>{let t=e.data(),a="",s="fas fa-info-circle",l="bg-warning";if("pending"===t.status)a=`Order #${e.id.substring(0,8)} is pending seller confirmation.`,s="fas fa-clock",l="bg-warning";else if("active"===t.status)a=`Order #${e.id.substring(0,8)} confirmed! Ready for pickup.`,s="fas fa-check-circle",l="bg-success";else if("cancelled"===t.status||"rejected"===t.status)a=`Order #${e.id.substring(0,8)} has been cancelled/rejected.`,s="fas fa-ban",l="bg-danger";else{if("returned"!==t.status)return;a=`Order #${e.id.substring(0,8)} equipment returned. Final review pending.`,s="fas fa-undo-alt",l="bg-info"}let o=t.updatedAt?.toMillis()||t.createdAt?.toMillis()||0,c=o>n;c&&r++,i.push({id:e.id,message:a,icon:s,badgeClass:l,date:t.updatedAt||t.createdAt,status:t.status,isUnread:c})});let l=await window.FirebaseDB.collection("artifacts").doc(e).collection("public").doc("data").collection("conversations").where("customerId","==",window.currentUser.uid).get();l.forEach(e=>{let t=e.data();s+=t.unreadCountCustomer||0,t.unreadCountCustomer>0&&i.push({id:e.id,type:"new_chat_message",message:`New message from ${t.sellerBusinessName}: ${t.lastMessage.substring(0,20)}...`,icon:"fas fa-comment-dots",badgeClass:"bg-info",date:t.updatedAt,status:"chat_unread",isUnread:!0})}),i.sort((e,t)=>(t.date?.toMillis()||0)-(e.date?.toMillis()||0));let o=r+s,c=document.getElementById("customer-notification-count"),d=document.getElementById("customer-notifications-list"),u=i.slice(0,5);c&&(c.textContent=window.currentUser&&o>0?o:""),d&&(d.innerHTML='<li><h6 class="dropdown-header">Alerts & Updates</h6></li>'),0===u.length?d&&(d.innerHTML+='<li><a class="dropdown-item text-center text-muted" href="#">No recent alerts.</a></li>'):u.forEach(e=>{let t=e.date?window.firebaseHelpers.formatTimeAgo(e.date):"N/A",a=e.isUnread?"fw-bold":"text-muted";if("chat_unread"===e.status){let i=e.id.split("_"),r=i[0],s=i[1],n=e.message.split(":")[0].replace("New message from ","").trim(),l=`openOrderChat('${r}', '${s}', '${n}')`;d&&(d.innerHTML+=`
                        <li>
                            <a class="dropdown-item d-flex justify-content-between align-items-center ${a}" href="#" onclick="${l}" title="${e.message}">
                                <div>
                                    <span class="badge ${e.badgeClass} me-2"><i class="${e.icon}"></i></span>
                                    ${e.message.substring(0,30)}...
                                </div>
                                <small class="text-muted ms-2">${t}</small>
                            </a>
                        </li>
                    `);return}d&&(d.innerHTML+=`
                    <li>
                        <a class="dropdown-item d-flex justify-content-between align-items-center ${a}" href="orders.html" title="${e.message}">
                            <div>
                                <span class="badge ${e.badgeClass} me-2"><i class="${e.icon}"></i></span>
                                ${e.message.substring(0,30)}...
                            </div>
                            <small class="text-muted ms-2">${t}</small>
                        </a>
                    </li>
                `)}),d&&(d.innerHTML+=`
                <li><hr class="dropdown-divider"></li>
                <li><a class="dropdown-item text-center" href="orders.html">View All Orders</a></li>
                <li><hr class="dropdown-divider"></li>
                <li><a class="dropdown-item text-center text-primary small" href="#" onclick="markCustomerNotificationsAsRead()">
                    <i class="fas fa-check-double me-1"></i> Clear Alerts
                </a></li>
            `)}catch(m){let p=document.getElementById("customer-notification-count");p&&(p.textContent="");let f=document.getElementById("customer-notifications-list");f&&(f.innerHTML='<li><h6 class="dropdown-header">Alerts & Updates</h6></li><li><a class="dropdown-item text-center text-danger" href="#">Error loading alerts.</a></li><li><hr class="dropdown-divider"></li><li><a class="dropdown-item text-center text-primary small" href="#" onclick="markCustomerNotificationsAsRead()"><i class="fas fa-check-double me-1"></i> Clear Alerts</a></li>')}}function updateNavbarForLoggedOutUser(){let e=document.getElementById("navbar-auth");e&&(e.innerHTML=`
        <li class="nav-item dropdown" id="role-dropdown">
            <a class="nav-link dropdown-toggle" href="#" id="roleDropdown" role="button" data-bs-toggle="dropdown">
                <i class="fas fa-user-tag me-1"></i> Sign Up As
            </a>
            <ul class="dropdown-menu">
                <li><a class="dropdown-item" href="customer-auth.html"><i class="fas fa-user me-2"></i>Customer</a></li>
                <li><a class="dropdown-item" href="seller-auth.html"><i class="fas fa-store me-2"></i>Seller</a></li>
                <li><a class="dropdown-item" href="admin-auth.html"><i class="fas fa-user-shield me-2"></i>Admin</a></li>
            </ul>
        </li>
        <li class="nav-item">
            <a class="nav-link" href="auth.html">
                <i class="fas fa-sign-in-alt me-1"></i> Login
            </a>
        </li>
    `)}async function loadHomepageData(){try{await loadCategories(),await loadFeaturedEquipment(),await loadStats(),loadHowItWorks(),await loadTestimonials(),await loadPopularEquipmentFooter(),updateHomepagePincodeDisplay()}catch(e){}}async function loadNavbarCategories(){try{let e=await window.FirebaseDB.collection("equipment").where("status","==","approved").get(),t={};e.forEach(e=>{let a=e.data();if(a.category){let i=a.category.charAt(0).toUpperCase()+a.category.slice(1);t[i]||(t[i]={name:i,icon:getCategoryIcon(a.category),count:0}),t[i].count++}});let a=Object.values(t);a.sort((e,t)=>e.name.localeCompare(t.name));let i=document.getElementById("navbar-categories-menu");if(!i)return;if(i.innerHTML="",0===a.length){i.innerHTML='<li><a class="dropdown-item disabled">No categories found</a></li>';return}a.slice(0,8).forEach(e=>{let t=document.createElement("li");t.innerHTML=`
                <a class="dropdown-item d-flex align-items-center" href="browse.html?category=${e.name.toLowerCase()}">
                    <i class="${e.icon||"fas fa-tools"} me-2"></i>
                    ${e.name}
                    <span class="badge bg-primary ms-auto">${e.count}</span>
                </a>
            `,i.appendChild(t)});let r=document.createElement("li");r.innerHTML=`
            <li><hr class="dropdown-divider"></li>
            <li><a class="dropdown-item text-center text-primary" href="browse.html">
                <i class="fas fa-eye me-2"></i>View All Categories
            </a></li>
        `,i.appendChild(r)}catch(s){let n=document.getElementById("navbar-categories-menu");n&&(n.innerHTML='<li><a class="dropdown-item disabled text-danger">Error loading categories</a></li>')}}async function loadCategories(){try{let e=await window.FirebaseDB.collection("equipment").where("status","==","approved").get(),t={};e.forEach(e=>{let a=e.data();if(a.category){let i=a.category.charAt(0).toUpperCase()+a.category.slice(1);t[i]||(t[i]={name:i,icon:getCategoryIcon(a.category),count:0}),t[i].count++}});let a=Object.values(t);a.sort((e,t)=>e.name.localeCompare(t.name));let i=document.getElementById("categories-container");if(!i)return;if(i.innerHTML="",0===a.length){i.innerHTML='<div class="col-12 text-center"><p>No equipment or categories found.</p></div>';return}a.slice(0,6).forEach(e=>{let t=document.createElement("div");t.className="col-md-4 col-sm-6 mb-4",t.innerHTML=`
                <div class="card category-card text-center p-4 h-100">
                    <div class="category-icon">
                        <i class="${e.icon||"fas fa-question-circle"}"></i>
                    </div>
                    <h5>${e.name}</h5>
                    <p class="text-muted">${e.count} items available</p>
                    <a href="browse.html?category=${e.name.toLowerCase()}" class="btn btn-outline-primary mt-auto">View Equipment</a>
                </div>
            `,i.appendChild(t)})}catch(r){}}async function loadStats(){try{let e=document.getElementById("stats-container");if(!e)return;let t=await window.FirebaseDB.collection("stats").doc("platform").get(),a=t.exists?t.data():{happyFarmers:500,districtsCovered:25,acresServed:5e4,supportHours:"24/7"};e.innerHTML=`
            <div class="col-md-3 col-6">
                <div class="stat-item">
                    <div class="stat-number">${a.happyFarmers}+</div>
                    <div class="stat-label">Happy Farmers</div>
                </div>
            </div>
            <div class="col-md-3 col-6">
                <div class="stat-item">
                    <div class="stat-number">${a.districtsCovered}+</div>
                    <div class="stat-label">Districts Covered</div>
                </div>
            </div>
            <div class="col-md-3 col-6">
                <div class="stat-item">
                    <div class="stat-number">${a.acresServed}+</div>
                    <div class="stat-label">Acres Served</div>
                </div>
            </div>
            <div class="col-md-3 col-6">
                <div class="stat-item">
                    <div class="stat-number">${a.supportHours}</div>
                    <div class="stat-label">Farmer Support</div>
                </div>
            </div>
        `}catch(i){}}function loadHowItWorks(){let e=document.getElementById("how-it-works-container");if(!e)return;e.innerHTML=[{icon:"fas fa-search",title:"Browse & Select",description:"Choose from our wide range of farming equipment. Filter by type, capacity, or location."},{icon:"fas fa-calendar-check",title:"Book Date & Confirm",description:"Select rental acres/hours, **set your required pickup date/time**, add to cart, and confirm your booking with easy payment options."},{icon:"fas fa-hand-paper",title:"Pickup & Use",description:"Self-pickup the equipment from the seller's location on your selected date/time. Fully serviced and ready for your farming needs."}].map(e=>`
        <div class="col-md-4">
            <div class="process-step">
                <div class="step-icon">
                    <i class="${e.icon}"></i>
                </div>
                <h4>${e.title}</h4>
                <p>${e.description}</p>
            </div>
        </div>
    `).join("");let t=e.querySelectorAll(".process-step");if(t.length>=3){let a=t[2].querySelector(".step-icon");a&&(a.style.background="linear-gradient(135deg, #1e4a1e, var(--farm-green))")}}async function loadTestimonials(){try{let e=document.getElementById("testimonials-container");if(!e)return;let t=await window.FirebaseDB.collection("testimonials").where("approved","==",!0).limit(3).get();if(t.empty){e.innerHTML=getDefaultTestimonials();return}e.innerHTML="",t.forEach(t=>{let a=t.data(),i=document.createElement("div");i.className="col-md-4 mb-4",i.innerHTML=createTestimonialCard(a),e.appendChild(i)})}catch(a){let i=document.getElementById("testimonials-container");i&&(i.innerHTML=getDefaultTestimonials())}}function createTestimonialCard(e){let t=e.customerName?e.customerName.split(" ").map(e=>e[0]).join("").toUpperCase():"CU";return`
        <div class="testimonial-card h-100">
            <div class="testimonial-text">
                "${e.comment}"
            </div>
            <div class="client-info">
                <div class="client-avatar">${t}</div>
                <div>
                    <h5 class="mb-0">${e.customerName||"Customer"}</h5>
                    <small class="text-muted">${e.location||"Farm Owner"}</small>
                </div>
            </div>
        </div>
    `}function getDefaultTestimonials(){return`
        <div class="col-md-4">
            <div class="testimonial-card">
                <div class="testimonial-text">
                    "Rented a tractor and cultivator for my 10-acre farm. The equipment was in excellent condition and the seller's pickup location was convenient. Saved me from big investment!"
                </div>
                <div class="client-info">
                    <div class="client-avatar">SP</div>
                    <div>
                        <h5 class="mb-0">Suresh Patel</h5>
                        <small class="text-muted">Farmer, Karimnagar</small>
                    </div>
                </div>
            </div>
        </div>
        <div class="col-md-4">
            <div class="testimonial-card">
                <div class="testimonial-text">
                    "The agricultural drone service helped me monitor my crop health and spray pesticides efficiently. Easy pickup and modern technology at affordable rental rates!"
                </div>
                <div class="client-info">
                    <div class="client-avatar">RM</div>
                    <div>
                        <h5 class="mb-0">Ramesh</h5>
                        <small class="text-muted">Farm Owner, Warangal</small>
                    </div>
                </div>
            </div>
        </div>
        <div class="col-md-4">
            <div class="testimonial-card">
                <div class="testimonial-text">
                    "As a small farmer, I can't afford to buy a harvester. FarmRent made harvesting season stress-free with their reliable equipment rental and simple pickup process."
                </div>
                <div class="client-info">
                    <div class="client-avatar">PK</div>
                    <div>
                        <h5 class="mb-0">Surya Kumar</h5>
                        <small class="text-muted">Small Farmer, Nizamabad</small>
                    </div>
                </div>
            </div>
        </div>
    `}async function loadPopularEquipmentFooter(){try{let e=document.getElementById("popular-equipment-footer");if(!e)return;let t=await window.FirebaseDB.collection("equipment").where("status","==","approved").orderBy("rentalCount","desc").limit(4).get();if(t.empty){e.innerHTML=`
                <li><a href="browse.html?category=tractor" class="text-decoration-none text-light">Tractors</a></li>
                <li><a href="browse.html?category=harvester" class="text-decoration-none text-light">Harvesters</a></li>
                <li><a href="browse.html?category=spray" class="text-decoration-none text-light">Spray Machines</a></li>
                <li><a href="browse.html?category=drone" class="text-decoration-none text-light">Agricultural Drones</a></li>
            `;return}let a="";t.forEach(e=>{let t=e.data();a+=`<li><a href="item.html?id=${e.id}" class="text-decoration-none text-light">${t.name}</a></li>`}),e.innerHTML=a}catch(i){}}async function subscribeNewsletter(){let e=document.getElementById("newsletter-email"),t=e.value.trim();if(!t||!validateEmail(t)){window.firebaseHelpers.showAlert("Please enter a valid email address","warning");return}try{let a="undefined"!=typeof __app_id?__app_id:"default-app-id",i=window.FirebaseDB.collection("artifacts").doc(a).collection("public").doc("data").collection("newsletterSubscriptions");await i.add({email:t,subscribedAt:firebase.firestore.FieldValue.serverTimestamp(),active:!0}),window.firebaseHelpers.showAlert("Successfully subscribed to newsletter!","success"),e.value=""}catch(r){window.firebaseHelpers.showAlert("Error subscribing. Please try again.","danger")}}function validateEmail(e){return/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)}function initializeEventListeners(){loadNavbarCategories(),document.querySelectorAll('a[href^="#"]').forEach(e=>{e.addEventListener("click",function(e){let t=this.getAttribute("href");if("#"===t)return;e.preventDefault();let a=document.querySelector(t);a&&a.scrollIntoView({behavior:"smooth",block:"start"})})});let e=window.location.pathname.split("/").pop();if("auth.html"===e){let t=document.getElementById("pincode");t&&t.addEventListener("input",()=>{document.getElementById("signupCity").value="",document.getElementById("signupState").value="";let e=document.getElementById("signupVillage");e&&(e.innerHTML='<option value="">Enter Pincode Above</option>',e.disabled=!0),6===t.value.length&&window.populateLocationFields("pincode","signupVillage","signupCity","signupState","location-lookup-status")})}else if("profile.html"===e){let a=document.getElementById("profile-pincode");a&&a.addEventListener("input",()=>{if(window.currentUser&&"seller"===window.currentUser.role&&window.currentUser.pincode)return;document.getElementById("profile-city").value="",document.getElementById("profile-state").value="";let e=document.getElementById("profile-village");e&&(e.innerHTML='<option value="">Enter Pincode Above</option>',e.disabled=!0),6===a.value.length&&window.populateLocationFields("profile-pincode","profile-village","profile-city","profile-state","pincode-status-message")})}}async function loadCategoriesForFilter(){try{let e=await window.FirebaseDB.collection("equipment").where("status","==","approved").get(),t=new Set;e.forEach(e=>{let a=e.data();a.category&&t.add(a.category.toLowerCase())});let a=document.getElementById("category-filter");if(a){a.innerHTML='<option value="all">All Categories</option>';let i=Array.from(t).sort();i.forEach(e=>{let t=document.createElement("option");t.value=e,t.textContent=e.charAt(0).toUpperCase()+e.slice(1),a.appendChild(t)})}}catch(r){}}function getCategoryIcon(e){let t={tractor:"fas fa-tractor",harvester:"fas fa-dragon",cultivator:"fas fa-seedling",drone:"fas fa-helicopter",spray:"fas fa-spray-can",crane:"fas fa-crane",jcb:"fas fa-truck-pickup","grass-cutter":"fas fa-cut",trolley:"fas fa-truck-moving","water-tanker":"fas fa-truck-water",default:"fas fa-tools"};return t[e.toLowerCase()]||t.default}function filterEquipment(){let e=document.getElementById("search-input")?.value?.toLowerCase()||"",t=document.getElementById("category-filter")?.value||"all",a=document.getElementById("sort-by")?.value||"latest",i=allEquipmentData.filter(a=>{let i=a.name.toLowerCase().includes(e)||a.location.toLowerCase().includes(e)||a.description.toLowerCase().includes(e),r="all"===t||a.category.toLowerCase()===t;return i&&r});switch(a){case"price_asc":i.sort((e,t)=>(e.pricePerAcre||0)-(t.pricePerAcre||0));break;case"price_desc":i.sort((e,t)=>(t.pricePerAcre||0)-(e.pricePerAcre||0));break;default:i.sort((e,t)=>(t.createdAt?.toDate()||0)-(e.createdAt?.toDate()||0))}displayEquipmentGrid(i)}function displayEquipmentGrid(e){let t=document.getElementById("equipment-grid");if(!t)return;t.innerHTML="";let a=window.customerPincode||"N/A";if(0===e.length){let i="N/A"!==a?` in your Pincode area (${a})`:" without a location filter applied";t.innerHTML=`
            <div class="col-12 text-center py-5">
                <i class="fas fa-search-minus fa-3x text-muted mb-3"></i>
                <p class="mt-3">No equipment found${i}.</p>
                <p class="text-muted small">Try selecting "All Locations" or changing your Pincode.</p>
                <a href="#" class="btn btn-primary mt-3" onclick="showPincodeModal()">Set/Change Pincode Now</a>
            </div>
        `;return}e.forEach(e=>{let a=document.createElement("div");a.className="col-lg-4 col-md-6 mb-4",a.innerHTML=createEquipmentCard(e,e.id,!0),t.appendChild(a)})}async function displayCartItems(e){!window.currentUser&&e.length>0&&window.firebaseHelpers.showAlert("You are viewing a non-persistent cart. Log in to save your cart items.","info");let t=document.getElementById("cart-items-container"),a=document.getElementById("cart-loading");if(a&&(a.style.display="none"),t&&(t.innerHTML=""),0===e.length){t&&(t.innerHTML=`
            <div class="text-center py-5">
                <i class="fas fa-shopping-basket fa-3x text-muted mb-3"></i>
                <h4>Your cart is empty</h4>
                <p class="text-muted">Browse our equipment to find something to rent!</p>
                <a href="browse.html" class="btn btn-primary mt-3">Start Browsing</a>
            </div>
        `),updateCartSummary(0,0,0,!0);return}let i=0,r=document.getElementById("checkout-btn"),s=r&&r.disabled;e.forEach((e,a)=>{i+=e.price,t&&(t.innerHTML+=`
            <div class="d-flex align-items-center py-3 border-bottom">
                <img src="${e.imageUrl||"https://placehold.co/80x80"}" class="rounded me-3" style="width: 80px; height: 80px; object-fit: cover;">
                <div class="flex-grow-1">
                    <h5 class="mb-0">${e.name}</h5>
                    <p class="mb-0 small text-muted">Seller: ${e.businessName} (Pincode: ${e.pincode||"N/A"})</p>
                    <p class="mb-0 small text-primary">
                        ${e.rentalValue} ${"acre"===e.rentalType?"Acre(s)":"Hour(s)"}
                        (@ ${window.firebaseHelpers.formatCurrency("acre"===e.rentalType?e.pricePerAcre:e.pricePerHour)}/${e.rentalType})
                    </p>
                    <p class="mb-0 small text-danger">
                        <i class="fas fa-calendar-check me-1"></i> Pickup: ${e.pickupDate} at ${e.pickupTime}
                    </p>
                </div>
                <div class="text-end">
                    <strong class="text-success h5">${window.firebaseHelpers.formatCurrency(e.price)}</strong>
                    <button class="btn btn-sm btn-outline-danger d-block mt-2" onclick="removeItemFromCart(${a})">
                        <i class="fas fa-trash"></i> Remove
                    </button>
                </div>
            </div>
        `)});let n=i*platformFeeRate,l=i+n;updateCartSummary(i,n,l,s)}async function removeItemFromCart(e){let t=await getCartFromFirestore();t.splice(e,1),await updateCartInFirestore(t),window.firebaseHelpers.showAlert("Item removed from cart.","info"),loadCartPage()}function updateCartSummary(e,t,a,i){let r=document.getElementById("cart-subtotal");r&&(r.textContent=window.firebaseHelpers.formatCurrency(e));let s=document.getElementById("cart-discount");s&&(s.textContent=window.firebaseHelpers.formatCurrency(0));let n=document.getElementById("cart-fees");n&&(n.textContent=window.firebaseHelpers.formatCurrency(t));let l=document.getElementById("cart-total");l&&(l.textContent=window.firebaseHelpers.formatCurrency(a));let o=document.getElementById("checkout-btn");o&&(o.disabled=i||0===a)}function displayCheckoutSummary(e){let t=document.getElementById("checkout-item-list");if(!t)return;t.innerHTML="";let a=0;e.forEach(e=>{a+=Number(e.price)||0});let i=document.getElementById("rental-details"),r=e[0];i&&r&&(i.value=`${r.rentalValue} ${"acre"===r.rentalType?"Acre(s)":"Hour(s)"} | Pickup: ${r.pickupDate} @ ${r.pickupTime}`),window.razorpayContext={...window.razorpayContext,orderPickupDate:r?.pickupDate,orderPickupTime:r?.pickupTime,items:e,subtotal:a};let s=e.length>0?e[0].pincode:"N/A";e.forEach(e=>{t.innerHTML+=`
            <div class="order-item-card d-flex justify-content-between align-items-center">
                <div>
                    <strong>${e.name}</strong>
                    <div class="small text-muted">
                        ${e.rentalValue} ${e.rentalType} | By: ${e.businessName} (Pincode: ${e.pincode})
                        <br><i class="fas fa-calendar-check me-1"></i> Pickup: ${e.pickupDate} @ ${e.pickupTime}
                        <br><i class="fas fa-map-marked-alt me-1"></i> Address: ${e.sellerAddress}
                    </div>
                </div>
                <strong class="text-success">${window.firebaseHelpers.formatCurrency(e.price)}</strong>
            </div>
        `});let n=Math.floor(.5*a),l=Math.min(coinsToApply,availableCoins,n),o=l,c=a*platformFeeRate,d=a-o+c;if(d<1){let u=Math.abs(d-1);l=Math.max(0,l-Math.ceil(u));let m=l;d=a-m+c}d=Math.max(1,d),coinsToApply=l,window.razorpayContext={...window.razorpayContext,subtotal:a,fees:c,total:d,orderPincode:s,discount:o,coinsUsed:coinsToApply};let p=document.getElementById("checkout-fees-label");p&&(p.textContent=`Platform Fee (${(100*platformFeeRate).toFixed(0)}%):`);let f=document.getElementById("coins-to-apply");f&&(f.value=coinsToApply);let g=document.getElementById("checkout-discount");g&&(g.textContent=`-${window.firebaseHelpers.formatCurrency(o)}`);let h=document.getElementById("checkout-subtotal");h&&(h.textContent=window.firebaseHelpers.formatCurrency(a));let b=document.getElementById("checkout-fees");b&&(b.textContent=window.firebaseHelpers.formatCurrency(c));let y=document.getElementById("checkout-total");y&&(y.textContent=window.firebaseHelpers.formatCurrency(d)),window.updatePaymentButtonUI(d)}async function processPayment(){let e=document.getElementById("checkout-form");if(!e.checkValidity()){e.reportValidity(),window.firebaseHelpers.showAlert("Please fill all required customer details.","warning");return}let t=window.firebaseHelpers.pincodeSystem.getCurrentPincode();if(!t){window.firebaseHelpers.showAlert("Critical Error: Customer Pincode is not set. Cannot proceed.","danger");let a=document.getElementById("pay-now-btn");a&&(a.disabled=!0);return}let{total:i,orderPickupDate:r,orderPickupTime:s,discount:n,coinsUsed:l}=window.razorpayContext,o=Math.round(100*i);if(o<100){window.firebaseHelpers.showAlert("Total amount must be at least ₹1 to proceed with payment.","warning");return}let c={name:document.getElementById("customer-name").value,email:document.getElementById("customer-email").value,phone:document.getElementById("customer-phone").value,address:"Self-Pickup Confirmed",notes:document.getElementById("additional-notes").value,isPickup:!0,pickupDate:r,pickupTime:s},d=window.firebaseHelpers.generateId(),u=await window.firebaseHelpers.getRazorpayKeyId();if(!u){window.firebaseHelpers.showAlert("Payment gateway configuration error. Please try again later.","danger");return}if("undefined"==typeof Razorpay){window.firebaseHelpers.showAlert("Payment system is loading. Please wait a moment and try again.","warning");return}let m={key:u,amount:o,currency:"INR",name:"FarmRent",description:"Rental Equipment Booking",handler:async function(e){await placeOrderInFirestore(d,c,e.razorpay_payment_id,i,"paid","Razorpay",n,l)},prefill:{name:c.name,email:c.email,contact:c.phone},theme:{color:"#2B5C2B"},modal:{ondismiss:function(){window.firebaseHelpers.showAlert("Payment cancelled. Your booking is not confirmed.","info")}}};try{let p=new Razorpay(m);p.on("payment.failed",function(e){let t=e.error?`${e.error.description} (Code: ${e.error.code})`:"Payment failed. Please try again.";window.firebaseHelpers.showAlert("Payment failed: "+t,"danger")}),p.open()}catch(f){window.firebaseHelpers.showAlert("Error initializing payment: "+f.message,"danger")}}async function loadProfilePage(){let e=await window.firebaseHelpers.getCurrentUser();if(!e){window.firebaseHelpers.showAlert("You must be logged in to view your profile.","danger"),setTimeout(()=>{window.location.href="customer-auth.html"},2e3);return}let t=window.FirebaseDB.collection("users").doc(e.uid),a=await t.get();if(a.exists){let i=a.data(),r=!1;void 0===i.coins&&(i.coins=0,r=!0),void 0===i.referralCode&&(i.referralCode=generateReferralCode(),r=!0),void 0===i.firstOrderPlaced&&(i.firstOrderPlaced=!1,r=!0),r&&await t.set({coins:i.coins,referralCode:i.referralCode,firstOrderPlaced:i.firstOrderPlaced},{merge:!0}),window.currentUser={...e,...i},availableCoins=window.currentUser.coins}let s=document.getElementById("profile-name");s&&(s.value=e.name||"");let n=document.getElementById("profile-email");n&&(n.value=e.email||"");let l=document.getElementById("profile-phone");l&&(l.value=e.mobile||"");let o=document.getElementById("profile-address");o&&(o.value=e.address||"");let c=document.getElementById("profile-city");c&&(c.value=e.city||"");let d=document.getElementById("profile-state");d&&(d.value=e.state||"");let u=document.getElementById("profile-pincode");u&&(u.value=e.pincode||"");let m=document.getElementById("profile-user-name");m&&(m.textContent=e.name||"User");let p=document.getElementById("profile-coin-balance");p&&(p.textContent=`${availableCoins||0} Coins`);let f=document.getElementById("referral-code-display"),g=document.getElementById("referral-link-display"),h=window.currentUser.referralCode||generateReferralCode();f&&(f.value=h),g&&(g.value=window.getReferralLink(h));let b="seller"===e.role,y=!!e.pincode;if(b&&y){let v=document.getElementById("profile-pincode");v&&(v.readOnly=!0,v.classList.add("bg-light","text-muted"));let w=document.getElementById("pincode-input-group");w&&!w.querySelector(".alert")&&(w.innerHTML+=`
                    <div class="alert alert-warning p-2 mt-2 small">
                        <i class="fas fa-lock me-1"></i> Your Seller Pincode is permanent for consistency. Contact support to change location.
                    </div>
                `)}e.pincode&&(async()=>{await populateLocationFields("profile-pincode","profile-village","profile-city","profile-state","pincode-status-message");let t=document.getElementById("profile-village");t&&e.village&&setTimeout(()=>{t.value=e.village},500)})();let C=document.getElementById("join-date");C&&(e.createdAt&&e.createdAt.toDate?C.textContent=e.createdAt.toDate().toLocaleDateString():e.createdAt&&(C.textContent=new Date(e.createdAt).toLocaleDateString()));let $=document.getElementById("profile-form");$&&$.addEventListener("submit",handleProfileUpdate)}async function handleProfileUpdate(e){if(e.preventDefault(),!window.currentUser)return;let t=document.getElementById("profile-pincode").value.trim(),a=document.getElementById("profile-village");if(!t||!window.firebaseHelpers.pincodeSystem.validatePincode(t)){window.firebaseHelpers.showAlert("Please enter a valid 6-digit Pincode.","danger");return}if(a&&!a.value){window.firebaseHelpers.showAlert("Please select your Village/Post Office.","danger");return}if(!document.getElementById("profile-city").value||!document.getElementById("profile-state").value){window.firebaseHelpers.showAlert("Pincode lookup failed. Please try again or verify your Pincode.","danger");return}let i={name:document.getElementById("profile-name").value,mobile:document.getElementById("profile-phone").value,address:document.getElementById("profile-address").value,city:document.getElementById("profile-city").value,state:document.getElementById("profile-state").value,village:a?a.value:"",pincode:t,updatedAt:firebase.firestore.FieldValue.serverTimestamp()};"seller"===window.currentUser.role&&window.currentUser.pincode&&(i.pincode=window.currentUser.pincode);try{await window.FirebaseDB.collection("users").doc(window.currentUser.uid).update(i),window.firebaseHelpers.showAlert("Profile updated successfully!","success"),window.currentUser={...window.currentUser,...i},await window.firebaseHelpers.pincodeSystem.setPincode(i.pincode);let r=window.location.pathname.split("/").pop();"browse.html"===r&&(updatePincodeDisplay(),loadAllEquipment())}catch(s){window.firebaseHelpers.showAlert("Error updating profile. Please try again.","danger")}}async function loadOrdersPage(){let e=await window.firebaseHelpers.getCurrentUser();if(!e){window.firebaseHelpers.showAlert("You must be logged in to view your orders.","danger"),setTimeout(()=>{window.location.href="customer-auth.html"},2e3);return}let t=document.getElementById("loading");t&&(t.style.display="block");try{let a="undefined"!=typeof __app_id?__app_id:"default-app-id",i=window.FirebaseDB.collection("artifacts").doc(a).collection("public").doc("data").collection("orders"),r=await i.where("userId","==",e.uid).orderBy("createdAt","desc").get(),s=document.getElementById("orders-list");if(s&&(s.innerHTML=""),r.empty){s&&(s.innerHTML=`
                <div class="col-12 text-center py-5">
                    <i class="fas fa-box-open fa-3x text-muted mb-3"></i>
                    <h4>You have no rental history</h4>
                    <p>Start browsing to place your first order.</p>
                    <a href="browse.html" class="btn btn-primary mt-3">Browse Equipment</a>
                </div>
            `);return}r.forEach(e=>{let t={id:e.id,...e.data()};s&&(s.innerHTML+=createOrderCard(t))})}catch(n){let l=document.getElementById("orders-list");l&&(l.innerHTML=`
            <div class="col-12 text-center py-5 text-danger">
                <i class="fas fa-exclamation-triangle fa-3x mb-3"></i>
                <h4>Error loading orders</h4>
                <p>Please try again later.</p>
            </div>
        `)}finally{t&&(t.style.display="none")}}function createOrderCard(e){let t=`order-status-${e.status||"pending"}`,a=(e.status||"pending").charAt(0).toUpperCase()+(e.status||"pending").slice(1),i=window.firebaseHelpers.formatDate(e.createdAt),r=e.pickupDate||"N/A",s=e.pickupTime||"N/A",n=e.coinsUsed>0?`<div class="text-danger small">Coins Used: ${e.coinsUsed} (${window.firebaseHelpers.formatCurrency(e.discount)})</div>`:"",l="";"completed"!==e.status||e.isReviewed?e.isReviewed&&(l=`
            <button class="btn btn-sm btn-outline-success ms-2" disabled>
                <i class="fas fa-check-circle me-1"></i> Reviewed
            </button>
        `):l=`
            <button class="btn btn-sm btn-warning ms-2" onclick="openReviewModal('${e.id}', '${e.sellerIds||""}')">
                <i class="fas fa-star me-1"></i> Rate
            </button>
        `;let o="";if(["pending","active","pickedup","returned","completed"].includes(e.status)){let c=e.sellerIds?e.sellerIds[0]:"",d=e.sellerBusinessNames?e.sellerBusinessNames.split(",")[0]:"Seller";c&&(o=`
                <button class="btn btn-sm btn-primary ms-2" onclick="openOrderChat('${e.id}', '${c}', '${d.trim()}')">
                    <i class="fas fa-comments me-1"></i> Chat
                </button>
            `)}return`
        <div class="col-lg-12 mb-4">
            <div class="card order-card shadow-sm">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <div>
                        <h5 class="mb-0">Order #${e.id.substring(0,8)}</h5>
                        <small class="text-muted">Placed on: ${i}</small>
                    </div>
                    <div>
                        <span class="badge bg-warning text-dark me-2"><i class="fas fa-hand-paper me-1"></i>Self-Pickup</span>
                        <span class="status-badge ${t}">${a}</span>
                    </div>
                </div>
                <div class="card-body">
                    <h6>Equipment Rented:</h6>
                    <ul class="list-unstyled mb-3">
                        ${e.items.map(e=>`
                            <li class="d-flex align-items-center mb-1">
                                <img src="${e.imageUrl||"https://placehold.co/40x40"}" class="rounded me-2" style="width: 40px; height: 40px; object-fit: cover;">
                                <div>
                                    <strong>${e.name}</strong> - ${e.rentalValue} ${"acre"===e.rentalType?"Acre(s)":"Hour(s)"}
                                    <small class="text-muted d-block">Seller: ${e.businessName} (Pincode: ${e.pincode||"N/A"})</small>
                                </div>
                            </li>
                        `).join("")}
                    </ul>
                    <div class="row border-top pt-2">
                        <div class="col-md-6">
                            <strong>Total Amount:</strong> <span class="text-primary">${window.firebaseHelpers.formatCurrency(e.totalAmount||0)}</span>
                            ${n}
                        </div>
                        <div class="col-md-6 text-md-end">
                            <strong>Pickup Pincode:</strong> ${e.orderPincode||"N/A"}
                        </div>
                        <div class="col-12 mt-2">
                            <span class="badge bg-danger text-white"><i class="fas fa-calendar-check me-1"></i> Pickup Date/Time:</span> 
                            <strong>${r} at ${s}</strong>
                        </div>
                    </div>
                    ${createOrderTrackerHtml(e.status,!0)} 
                </div>
                <div class="card-footer text-end">
                    ${"pending"===e.status?`
                        <button class="btn btn-sm btn-danger" onclick="cancelOrder('${e.id}')">Cancel Order</button>
                    `:""}
                    <button class="btn btn-sm btn-outline-primary" onclick="viewOrderDetailsModal('${e.id}')">View Details & Track</button>
                    ${o}
                    ${l}
                </div>
            </div>
        </div>
    `}function createOrderTrackerHtml(e,t=!1){let a={pending:{progress:0,index:0,showCancel:!0},active:{progress:25,index:1,showCancel:!0},pickedup:{progress:50,index:2,showCancel:!1},returned:{progress:75,index:3,showCancel:!1},completed:{progress:100,index:4,showCancel:!1},cancelled:{progress:0,index:-1,showCancel:!1},rejected:{progress:0,index:-1,showCancel:!1}},i=a[e]||a.pending,r="completed"===e||"cancelled"===e||"rejected"===e;if(r&&"completed"!==e)return`
            <div class="alert alert-danger text-center mt-3 mb-0 p-3">
                <i class="${"cancelled"===e?"fas fa-ban":"fas fa-times-circle"} me-2"></i> <strong>${"cancelled"===e?"Order Cancelled":"Order Rejected by Seller"}</strong>. 
                ${"cancelled"===e?"Cancellation requested.":"Contact seller for details."}
            </div>
        `;let s=i.progress,n=[{key:"pending",text:"Order Placed",icon:"fas fa-clipboard-list"},{key:"active",text:"Seller Confirmed",icon:"fas fa-check-circle"},{key:"pickedup",text:"Customer Picked Up",icon:"fas fa-truck-loading"},{key:"returned",text:"Equipment Returned",icon:"fas fa-undo-alt"},{key:"completed",text:"Rental Completed",icon:"fas fa-flag-checkered"}].map((t,a)=>{let s="";return a<i.index?s="completed":a!==i.index||r?a===i.index&&"completed"===e&&(s="completed"):s="active",`
            <div class="tracker-step ${s}">
                <div class="step-icon-container">
                    <i class="${t.icon}"></i>
                </div>
                <div class="step-text">${t.text}</div>
            </div>
        `}).join("");return`
        <div class="order-tracker ${t?"p-2 mt-2 mb-0":"p-4"}">
            <div class="tracker-line">
                <div class="tracker-progress" style="width: ${s}%;"></div>
            </div>
            ${n}
        </div>
    `}async function viewOrderDetailsModal(e){try{let t="undefined"!=typeof __app_id?__app_id:"default-app-id",a=window.FirebaseDB.collection("artifacts").doc(t).collection("public").doc("data").collection("orders"),i=document.getElementById("orderDetailsModal"),r=new bootstrap.Modal(i);r.show();let s=a.doc(e).onSnapshot(t=>{if(!t.exists){r.hide(),window.firebaseHelpers.showAlert("Order not found or deleted.","danger"),s(),loadOrdersPage();return}let a=t.data(),n=`order-status-${a.status||"pending"}`,l=(a.status||"pending").charAt(0).toUpperCase()+(a.status||"pending").slice(1),o=a.coinsUsed||0,c=a.discount||0,d=a.subtotalAmount||0,u=a.platformFee||0,m=a.platformCommissionAmount||0,p=a.sellerNetEarnings||0,f=a.settlementStatus||"unsettled",g=a.settledAmount||0,h=a.settledAt?window.firebaseHelpers.formatDateTime(a.settledAt):"N/A",b=o>0?`<tr><th>Coin Discount:</th><td><strong class="text-danger">-${window.firebaseHelpers.formatCurrency(c)} (${o} Coins)</strong></td></tr>`:"",y=`
                <h6 class="mt-4 text-dark"><i class="fas fa-handshake me-2"></i>Platform Settlement Details</h6>
                <table class="table table-sm table-borderless">
                    <tr><th>Rental Subtotal:</th><td>${window.firebaseHelpers.formatCurrency(d)}</td></tr>
                    <tr><th>Platform Commission (${(100*a.platformCommissionRate).toFixed(1)}%):</th><td><strong class="text-danger">-${window.firebaseHelpers.formatCurrency(m)}</strong></td></tr>
                    <tr><th>Seller Payout Due:</th><td><strong class="text-success">${window.firebaseHelpers.formatCurrency(p)}</strong></td></tr>
                    <tr><th>Settlement Status:</th><td><span class="badge bg-${"settled"===f?"success":"warning"}">${f}</span></td></tr>
                    ${"settled"===f?`
                        <tr><th>Settled Amount:</th><td>${window.firebaseHelpers.formatCurrency(g)}</td></tr>
                        <tr><th>Settled Date:</th><td>${h}</td></tr>
                    `:""}
                </table>
            `,v=`
                <h5 class="mb-3">Order # ${e.substring(0,8)} Details</h5>
                <div class="alert alert-info d-flex justify-content-between">
                    <div><strong>Current Status:</strong> <span class="status-badge ${n}">${l}</span></div>
                    <div><strong>Date Placed:</strong> ${window.firebaseHelpers.formatDateTime(a.createdAt)}</div>
                </div>
                <h6 class="mt-4 text-primary">Customer & Pickup Information</h6>
                <table class="table table-sm table-borderless">
                    <tr><th>Customer Name:</th><td>${a.customerName||"N/A"}</td></tr>
                    <tr><th>Phone:</th><td>${a.customerPhone||"N/A"}</td></tr>
                    <tr><th>Email:</th><td>${a.customerEmail||"N/A"}</td></tr>
                    <tr><th>Pickup Date/Time:</th><td><strong>${a.pickupDate||"N/A"} at ${a.pickupTime||"N/A"}</strong></td></tr>
                    <tr><th>Pickup Pincode:</th><td>${a.orderPincode||"N/A"}</td></tr>
                    <tr><th>Notes:</th><td>${a.notes||"None"}</td></tr>
                </table>
                <h6 class="mt-4 text-success">Equipment Details</h6>
                <ul class="list-group mb-4">
                    ${a.items.map(e=>`
                        <li class="list-group-item d-flex justify-content-between align-items-center">
                            <div>
                                <strong>${e.name}</strong> 
                                <small class="text-muted d-block">${e.rentalValue} ${e.rentalType} | Seller: ${e.businessName}</small>
                                <small class="text-muted d-block">Address: ${e.sellerAddress}</small>
                            </div>
                            <span class="badge bg-success">${window.firebaseHelpers.formatCurrency(e.price)}</span>
                        </li>
                    `).join("")}
                </ul>
                <h6 class="mt-4 text-warning">Customer Payment Summary</h6>
                <table class="table table-sm table-borderless">
                    <tr><th>Rental Subtotal:</th><td>${window.firebaseHelpers.formatCurrency(d)}</td></tr>
                    ${b}
                    <tr><th>Platform Fee (Customer-facing):</th><td>+${window.firebaseHelpers.formatCurrency(u)}</td></tr>
                    <tr><th>Total Paid:</th><td><strong>${window.firebaseHelpers.formatCurrency(a.totalAmount||0)}</strong></td></tr>
                    <tr><th>Payment Method:</th><td>${a.paymentMethod||"N/A"}</td></tr>
                    <tr><th>Payment Status:</th><td><span class="badge bg-${"paid"===a.paymentStatus?"success":"danger"}">${a.paymentStatus||"N/A"}</span></td></tr>
                    <tr><th>Transaction ID:</th><td><small>${a.transactionId||"N/A"}</small></td></tr>
                </table>
                ${y} <!-- NEW: Settlement Details -->
            `,w=document.getElementById("order-tracker-container");w&&(w.innerHTML=createOrderTrackerHtml(a.status,!1));let C=document.getElementById("order-details-content");C&&(C.innerHTML=v);let $=i.querySelector(".modal-footer");$.innerHTML='<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>',"pending"===a.status&&($.innerHTML+=`
                    <button class="btn btn-danger" onclick="cancelOrder('${a.id}')">Cancel Order</button>
                `),loadOrdersPage(),checkCustomerNotifications()},e=>{r.hide(),window.firebaseHelpers.showAlert("Error listening for order updates.","danger")});i.addEventListener("hidden.bs.modal",function e(){s(),i.removeEventListener("hidden.bs.modal",e)})}catch(n){window.firebaseHelpers.showAlert("Error loading order details.","danger")}}async function cancelOrder(e){let t=`
        <div class="modal fade" id="confirm-cancel-modal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header bg-danger text-white">
                        <h5 class="modal-title"><i class="fas fa-trash me-2"></i>Confirm Cancellation</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <p>Are you sure you want to cancel this order? Cancellation is subject to seller approval and refund processing. Only **Pending** orders can be cancelled.</p>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                        <button type="button" class="btn btn-danger" id="confirm-cancellation-btn">Yes, Cancel Order</button>
                    </div>
                </div>
            </div>
        </div>
    `;document.body.insertAdjacentHTML("beforeend",t);let a=document.getElementById("confirm-cancel-modal"),i=new bootstrap.Modal(a);i.show(),document.getElementById("confirm-cancellation-btn").onclick=async()=>{i.hide();try{let t="undefined"!=typeof __app_id?__app_id:"default-app-id",r=window.FirebaseDB.collection("artifacts").doc(t).collection("public").doc("data").collection("orders").doc(e),s=await r.get();if(!s.exists||"pending"!==s.data().status){window.firebaseHelpers.showAlert("Order cannot be cancelled. It is no longer pending.","danger");return}await r.update({status:"cancelled",cancellationRequestedAt:firebase.firestore.FieldValue.serverTimestamp(),updatedAt:firebase.firestore.FieldValue.serverTimestamp()}),window.firebaseHelpers.showAlert("Cancellation requested. Status will be updated shortly.","success");let n=bootstrap.Modal.getInstance(document.getElementById("orderDetailsModal"));n&&n.hide(),loadOrdersPage()}catch(l){window.firebaseHelpers.showAlert("Failed to cancel order. Please contact support.","danger")}finally{a.remove()}}}function openReviewModal(e,t){document.getElementById("review-order-id").value=e;let a=t.split(",")[0].trim();document.getElementById("review-seller-id").value=a,document.getElementById("review-form").reset();let i=new bootstrap.Modal(document.getElementById("reviewModal"));i.show()}async function submitReview(){let e=document.getElementById("review-order-id").value,t=document.getElementById("review-seller-id").value,a=document.querySelector('input[name="sellerRating"]:checked')?.value,i=document.querySelector('input[name="equipmentRating"]:checked')?.value,r=document.querySelector('input[name="experienceRating"]:checked')?.value,s=document.getElementById("review-comment").value;if(!a||!i||!r){window.firebaseHelpers.showAlert("Please provide ratings for all categories.","warning");return}try{let n="undefined"!=typeof __app_id?__app_id:"default-app-id",l={orderId:e,sellerId:t,customerId:window.currentUser.uid,customerName:window.currentUser.name,sellerRating:parseInt(a),equipmentRating:parseInt(i),experienceRating:parseInt(r),rating:Math.round((parseInt(a)+parseInt(i)+parseInt(r))/3),comment:s,createdAt:firebase.firestore.FieldValue.serverTimestamp()};await window.FirebaseDB.collection("reviews").add(l);let o=window.FirebaseDB.collection("artifacts").doc(n).collection("public").doc("data").collection("orders").doc(e);await o.update({isReviewed:!0,updatedAt:firebase.firestore.FieldValue.serverTimestamp()});let c=await o.get(),d=c.data().items||[];for(let u of d)if(u.id){let m=window.FirebaseDB.collection("equipment").doc(u.id),p=await m.get();if(p.exists){let f=p.data().rating||0,g=p.data().reviewCount||0,h=g+1,b=(f*g+parseInt(i))/h;await m.update({rating:b,reviewCount:h})}}window.firebaseHelpers.showAlert("Review submitted successfully!","success");let y=bootstrap.Modal.getInstance(document.getElementById("reviewModal"));y&&y.hide(),loadOrdersPage()}catch(v){window.firebaseHelpers.showAlert("Error submitting review. Please try again.","danger")}}function getStarRatingHtml(e){let t=parseFloat(e)||0,a=Math.floor(t),i=t%1>=.5,r='<div class="star-display mb-2">';for(let s=1;s<=5;s++)s<=a?r+='<i class="fas fa-star filled"></i>':s===a+1&&i?r+='<i class="fas fa-star-half-alt filled"></i>':r+='<i class="fas fa-star empty"></i>';let n=t>0?t.toFixed(1):"New";return r+`<span class="text-muted ms-1 small">(${n})</span></div>`}function updateChatBadgeCount(e){let t=document.getElementById("floating-chat-badge");t&&(e>0?(t.textContent=e>9?"9+":e,t.style.display="flex"):t.style.display="none")}function listenForUnreadChatMessages(){if(!window.currentUser||"customer"!==window.currentUser.role||!window.FirebaseDB){chatBadgeUnsubscribe&&chatBadgeUnsubscribe();return}chatBadgeUnsubscribe&&chatBadgeUnsubscribe();let e="undefined"!=typeof __app_id?__app_id:"default-app-id",t=window.FirebaseDB.collection("artifacts").doc(e).collection("public").doc("data").collection("conversations"),a=t.where("customerId","==",window.currentUser.uid);chatBadgeUnsubscribe=a.onSnapshot(e=>{let t=0;e.forEach(e=>{let a=e.data();t+=a.unreadCountCustomer||0}),updateChatBadgeCount(t)},e=>{updateChatBadgeCount(0)})}function renderChatWidget(){let e=document.getElementById("chat-widget-container");e&&(e.innerHTML=`
        <div class="chat-btn-floating" onclick="toggleChatWindow()">
            <i class="fas fa-comments"></i>
            <div id="floating-chat-badge" class="chat-badge" style="display:none;">0</div> 
        </div>
        <div class="chat-window hidden" id="customer-chat-window">
            <div class="chat-header">
                <div class="chat-header-info">
                    <h6 class="chat-header-title" id="chat-header-title">My Chats</h6>
                    <div id="chat-header-status" class="chat-header-status" style="display:none;">
                        <span class="status-dot"></span> <span id="status-text">Offline</span>
                    </div>
                </div>
                <button class="btn btn-sm btn-link text-white p-0" onclick="toggleChatWindow()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="chat-body" id="chat-body">
                <div class="text-center text-muted mt-5">
                    <p>Login to view your chats</p>
                </div>
            </div>
            <div id="quick-replies-container" class="quick-replies" style="display:none;">
                <span class="reply-chip" onclick="sendQuickReply('Is this available?')">Is this available?</span>
                <span class="reply-chip" onclick="sendQuickReply('What is the final price?')">Price?</span>
                <span class="reply-chip" onclick="sendQuickReply('Can I inspect it?')">Inspection?</span>
                <span class="reply-chip" onclick="sendQuickReply('Please call me.')">Call me</span>
            </div>
            <div class="chat-footer hidden" id="chat-input-container">
                <div id="customer-typing-indicator" class="typing-indicator" style="display:none; background:transparent; box-shadow:none; padding:0 0 5px 10px;">
                    <span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>
                </div>
                <div class="input-group">
                    <input type="text" class="form-control" id="chat-message-input" placeholder="Type a message...">
                    <button class="btn btn-primary" onclick="sendChatMessage()">
                        <i class="fas fa-paper-plane"></i>
                    </button>
                </div>
            </div>
        </div>
    `,window.currentUser&&loadUserConversations())}function toggleChatWindow(){let e=document.getElementById("customer-chat-window");e&&(e.classList.toggle("hidden"),e.classList.contains("hidden")||!window.currentUser||activeChatId||loadUserConversations(),e.classList.contains("hidden")||updateChatBadgeCount(0))}async function loadUserConversations(){let e=document.getElementById("chat-body"),t=document.getElementById("chat-input-container"),a=document.getElementById("quick-replies-container"),i=document.getElementById("chat-header-title"),r=document.getElementById("chat-header-status");if(!e)return;if(activeChatId=null,chatUnsubscribe&&(chatUnsubscribe(),chatUnsubscribe=null),t.classList.add("hidden"),a&&(a.style.display="none"),r&&(r.style.display="none"),i.textContent="My Chats",!window.currentUser){e.innerHTML='<div class="text-center text-muted mt-5"><p>Please login to chat.</p></div>';return}e.innerHTML='<div class="text-center mt-3"><div class="spinner-border spinner-border-sm text-primary"></div></div>';let s="undefined"!=typeof __app_id?__app_id:"default-app-id",n=window.FirebaseDB.collection("artifacts").doc(s).collection("public").doc("data").collection("conversations");try{let l=await n.where("customerId","==",window.currentUser.uid).orderBy("updatedAt","desc").get();if(e.innerHTML="",l.empty){e.innerHTML='<div class="text-center text-muted mt-5"><p>No active chats.<br>Go to Orders to start one.</p></div>';return}l.forEach(t=>{let a=t.data(),i=a.updatedAt?window.firebaseHelpers.formatTimeAgo(a.updatedAt):"",r=a.unreadCountCustomer>0?`<span class="badge bg-danger rounded-pill">${a.unreadCountCustomer}</span>`:"";e.innerHTML+=`
                <div class="p-3 border-bottom bg-white hover-bg-light cursor-pointer" onclick="loadChatMessages('${t.id}', '${a.sellerBusinessName}', '${a.sellerId}')" style="cursor:pointer;">
                    <div class="d-flex justify-content-between align-items-center mb-1">
                        <strong class="text-dark">${a.sellerBusinessName}</strong>
                        <span class="small text-muted">${i}</span>
                    </div>
                    <div class="d-flex justify-content-between align-items-center">
                        <small class="text-muted text-truncate" style="max-width: 200px;">${a.lastMessage||"Click to chat"}</small>
                        ${r}
                    </div>
                </div>
            `})}catch(o){e.innerHTML='<div class="text-center text-danger mt-3">Error loading chats.</div>'}}async function loadChatMessages(e,t,a){activeChatId=e;let i=document.getElementById("chat-body"),r=document.getElementById("chat-input-container"),s=document.getElementById("quick-replies-container"),n=document.getElementById("chat-header-title"),l=document.getElementById("chat-header-status"),o=document.getElementById("status-text"),c=l.querySelector(".status-dot");n.innerHTML=`<button class="btn btn-sm text-white p-0 me-2" onclick="loadUserConversations()"><i class="fas fa-arrow-left"></i></button> ${t}`,r.classList.remove("hidden"),s&&(s.style.display="flex"),l&&(l.style.display="flex"),i.innerHTML='<div class="text-center mt-3"><div class="spinner-border spinner-border-sm text-primary"></div></div>',a&&window.FirebaseDB.collection("users").doc(a).onSnapshot(e=>{let t=e.data(),a=t&&t.isOnline;o&&(o.textContent=a?"Online":"Offline"),c&&(c.className=`status-dot ${a?"online":"offline"}`);let r="custom-status-msg",s=document.getElementById(r);if(a||s||!i)a&&s&&s.remove();else{let n=document.createElement("div");n.id=r,n.className="system-message",n.textContent="Seller is currently offline. You can leave a message.",i.appendChild(n)}});let d="undefined"!=typeof __app_id?__app_id:"default-app-id",u=window.FirebaseDB.collection("artifacts").doc(d).collection("public").doc("data").collection("conversations").doc(e),m=u.collection("messages");chatUnsubscribe&&chatUnsubscribe(),chatUnsubscribe=m.orderBy("timestamp","asc").onSnapshot(e=>{i&&(i.innerHTML="",e.empty?i.innerHTML=`
                <div class="system-message mt-4">
                    Welcome to FarmRent Chat!<br>How can we help you today?
                </div>
            `:(e.forEach(e=>{let t=e.data(),a=t.senderId===window.currentUser.uid,r=t.timestamp?t.timestamp.toDate().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"";i.innerHTML+=`
                    <div style="display: flex; justify-content: ${a?"flex-end":"flex-start"}; margin-bottom: 8px;">
                        <div class="message-bubble ${a?"message-sent":"message-received"}">
                            ${t.text}
                            <span class="message-time">${r}</span>
                        </div>
                    </div>
                `}),i.scrollTop=i.scrollHeight),u.update({unreadCountCustomer:0}),checkCustomerNotifications())}),u.onSnapshot(e=>{let t=e.data(),a=document.getElementById("customer-typing-indicator");t&&t.typing&&t.typing.seller&&a?(a.style.display="flex",i&&(i.scrollTop=i.scrollHeight)):a&&(a.style.display="none")});let p=document.getElementById("chat-message-input");p&&(p.oninput=()=>{u.set({typing:{customer:!0}},{merge:!0}),clearTimeout(typingTimeout),typingTimeout=setTimeout(()=>{u.set({typing:{customer:!1}},{merge:!0})},2e3)},p.onkeypress=e=>{"Enter"===e.key&&sendChatMessage()})}async function openOrderChat(e,t,a){if(!window.currentUser){window.firebaseHelpers.showAlert("Please login to chat.","warning");return}let i=document.getElementById("customer-chat-window");i&&i.classList.remove("hidden");let r=`${e}_${t}_${window.currentUser.uid}`,s="undefined"!=typeof __app_id?__app_id:"default-app-id",n=window.FirebaseDB.collection("artifacts").doc(s).collection("public").doc("data").collection("conversations").doc(r),l=await n.get();l.exists||await n.set({orderId:e,sellerId:t,customerId:window.currentUser.uid,customerName:window.currentUser.name,sellerBusinessName:a,createdAt:firebase.firestore.FieldValue.serverTimestamp(),updatedAt:firebase.firestore.FieldValue.serverTimestamp(),unreadCountCustomer:0,unreadCountSeller:1}),loadChatMessages(r,a,t)}function sendQuickReply(e){let t=document.getElementById("chat-message-input");t&&(t.value=e,sendChatMessage())}async function sendChatMessage(){let e=document.getElementById("chat-message-input");if(!e)return;let t=e.value.trim();if(!t||!activeChatId||!window.currentUser)return;e.value="";let a="undefined"!=typeof __app_id?__app_id:"default-app-id",i=window.FirebaseDB.collection("artifacts").doc(a).collection("public").doc("data").collection("conversations").doc(activeChatId);try{clearTimeout(typingTimeout),await i.set({typing:{customer:!1}},{merge:!0}),await i.collection("messages").add({senderId:window.currentUser.uid,text:t,timestamp:firebase.firestore.FieldValue.serverTimestamp()}),await i.update({lastMessage:t,updatedAt:firebase.firestore.FieldValue.serverTimestamp(),unreadCountSeller:firebase.firestore.FieldValue.increment(1)})}catch(r){}}async function updateCartCount(){let e=await getCartFromFirestore(),t=document.getElementById("cart-count");t&&(t.textContent=e.length)}if(window.lookupReferralCode=lookupReferralCode,window.getCartFromFirestore=getCartFromFirestore,document.addEventListener("DOMContentLoaded",async()=>{await initializeAuth();let e=window.location.pathname.split("/").pop();"browse.html"===e?loadBrowsePageData():"cart.html"===e?(loadCartPage(),updateNavbarPincodeDisplay()):"checkout.html"===e?(loadCheckoutPage(),updateNavbarPincodeDisplay()):"profile.html"===e?(loadProfilePage(),updateNavbarPincodeDisplay()):"orders.html"===e?(loadOrdersPage(),updateNavbarPincodeDisplay()):"seller.html"===e||"seller-pending.html"===e?(window.loadSellerDashboard&&window.loadSellerDashboard(),updateNavbarPincodeDisplay()):"index.html"===e||""===e?(loadHomepageData(),checkAndPromptForPincode()):updateNavbarPincodeDisplay(),initializeEventListeners(),await getPlatformFinancialSettings(),"seller.html"!==e&&"seller-pending.html"!==e&&"admin.html"!==e&&setTimeout(()=>{document.getElementById("chat-widget-container")&&renderChatWidget()},1e3)}),window.getPostOfficeData=getPostOfficeData,window.populateLocationFields=populateLocationFields,window.getCurrentLocationPincode=getCurrentLocationPincode,window.showPincodeModal=showPincodeModal,window.savePincode=savePincode,window.skipPincode=skipPincode,window.updateCartForNewPincode=updateCartForNewPincode,window.revertToPreviousPincode=revertToPreviousPincode,window.changePincodeToMatchEquipment=changePincodeToMatchEquipment,window.showCustomWarningModal=showCustomWarningModal,window.logout=logout,window.showEquipmentDetailsModal=showEquipmentDetailsModal,window.addToCartModal=addToCartModal,window.rentNowModal=rentNowModal,window.resolveMixedPincodeCart=resolveMixedPincodeCart,window.changePincodeToMatchCart=changePincodeToMatchCart,window.clearCartForCurrentLocation=clearCartForCurrentLocation,window.startCheckout=startCheckout,window.markCustomerNotificationsAsRead=markCustomerNotificationsAsRead,window.subscribeNewsletter=subscribeNewsletter,window.filterEquipment=filterEquipment,window.removeItemFromCart=removeItemFromCart,window.createOrderTrackerHtml=createOrderTrackerHtml,window.viewOrderDetailsModal=viewOrderDetailsModal,window.cancelOrder=cancelOrder,window.openReviewModal=openReviewModal,window.submitReview=submitReview,window.toggleChatWindow=toggleChatWindow,window.loadUserConversations=loadUserConversations,window.loadChatMessages=loadChatMessages,window.openOrderChat=openOrderChat,window.sendQuickReply=sendQuickReply,window.sendChatMessage=sendChatMessage,window.updateCartCount=updateCartCount,"undefined"==typeof Razorpay){let e=document.createElement("script");e.src="https://checkout.razorpay.com/v1/checkout.js",document.head.appendChild(e)}function getRecentPincodes(){let e=localStorage.getItem("recentPincodes");return e?JSON.parse(e):[]}function addToRecentPincodes(e){let t=getRecentPincodes();return(t=t.filter(t=>t!==e)).unshift(e),t=t.slice(0,5),localStorage.setItem("recentPincodes",JSON.stringify(t)),t}function renderRecentPincodes(){let e=document.getElementById("recent-pincodes");if(!e)return;let t=getRecentPincodes();if(0===t.length){e.innerHTML=`
            <div class="text-center w-100">
                <small class="text-muted">No recent locations</small>
            </div>
        `;return}e.innerHTML="",t.forEach(t=>{let a=document.createElement("button");a.type="button",a.className="btn btn-sm btn-outline-secondary",a.textContent=t,a.onclick=()=>{document.getElementById("pincode-input").value=t,setTimeout(()=>{document.getElementById("pincode-form").dispatchEvent(new Event("submit"))},500)},e.appendChild(a)})}window.applyCoinDiscount=function(){let e=document.getElementById("coins-to-apply"),t=document.getElementById("coin-warning-text");if(!e)return;let a=parseInt(e.value)||0,i=window.razorpayContext?.items||[];if(0===i.length){t.textContent="Cart is empty. Please add items first.",t.classList.remove("text-muted","text-success","text-warning"),t.classList.add("text-danger");return}let r=0;i.forEach(e=>{r+=Number(e.price)||0});let s=Math.floor(.5*r),n=0;a<0?(n=0,t.textContent="Coins cannot be negative.",t.classList.remove("text-muted","text-success","text-warning"),t.classList.add("text-danger")):a>availableCoins?(n=Math.min(availableCoins,s),t.textContent=`Applied available maximum: ${n} coins.`,t.classList.remove("text-muted","text-danger","text-success"),t.classList.add("text-warning")):a>s?(n=s,t.textContent=`Applied maximum possible: ${s} coins. (Capped at 50% of subtotal)`,t.classList.remove("text-muted","text-success","text-warning"),t.classList.add("text-danger")):(n=a,t.textContent=`Applied ${n} coins successfully.`,t.classList.remove("text-muted","text-danger","text-warning"),t.classList.add("text-success")),coinsToApply=n,e.value=n,displayCheckoutSummary(i)},window.getReferralLink=function(e){if(!e)return"Code not available.";let t=window.location.origin;return`${t}/farmrent/customer-auth.html&ref=${e}`};
