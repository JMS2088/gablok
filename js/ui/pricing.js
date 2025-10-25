// Pricing modal logic extracted for SRP
(function(){
  function formatCurrency(amount) {
    return '$' + Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function calculatePricing(){
    // Depends on globals: PRICING, allRooms, stairsComponent, pergolaComponents, garageComponents, poolComponents, roofComponents, balconyComponents
    var breakdown = { rooms: [], components: [], totalCost: 0 };
    // Rooms
    if (Array.isArray(window.allRooms)){
      for (var i=0;i<allRooms.length;i++){
        var r = allRooms[i]; if(!r) continue;
        var area = Math.max(0, (r.width||0) * (r.depth||0));
        var cost = area * (window.PRICING && PRICING.room || 600);
        breakdown.rooms.push({ name: r.name || ('Room '+(i+1)), area: area, cost: cost });
        breakdown.totalCost += cost;
      }
    }
    // Components (flat pricing or per-area)
    function addBoxComponent(list, name, priceKey){
      if(!Array.isArray(list)) return;
      for(var j=0;j<list.length;j++){ var c=list[j]; if(!c) continue; breakdown.components.push({ name: name, area: (c.width||0)*(c.depth||0), cost: (window.PRICING && PRICING[priceKey] || 0) }); breakdown.totalCost += (window.PRICING && PRICING[priceKey] || 0); }
    }
    if (window.stairsComponent) { breakdown.components.push({ name:'Stairs', area:(stairsComponent.width||0)*(stairsComponent.depth||0), cost:(window.PRICING && PRICING.stairs || 1200) }); breakdown.totalCost += (window.PRICING && PRICING.stairs || 1200); }
    addBoxComponent(window.pergolaComponents, 'Pergola', 'pergola');
    addBoxComponent(window.garageComponents, 'Garage', 'garage');
    addBoxComponent(window.poolComponents, 'Pool', 'pool');
    addBoxComponent(window.roofComponents, 'Roof', 'roof');
    addBoxComponent(window.balconyComponents, 'Balcony', 'balcony');
    // Concrete slab and soil
    var groundRooms = (Array.isArray(window.allRooms)? allRooms.filter(function(r){ return (r.level||0)===0; }) : []);
    var groundSlabArea = 0; for (var g=0; g<groundRooms.length; g++){ groundSlabArea += Math.max(0, (groundRooms[g].width||0) * (groundRooms[g].depth||0)); }
    if (groundSlabArea > 0 && window.PRICING){
      var slabCost = groundSlabArea * (PRICING.concreteSlabPerSqm||0);
      breakdown.components.push({ name:'Concrete Slab (incl. reinforcement)', area: groundSlabArea, cost: slabCost });
      breakdown.totalCost += slabCost;
    }
    if (groundSlabArea > 0 && window.PRICING && (PRICING.slabThicknessM||0)>0){
      var soilVolumeM3 = groundSlabArea * (PRICING.slabThicknessM||0);
      var soilCost = 0; var unitsInfo = { volumeM3: soilVolumeM3 };
      if ((PRICING.soilPerM3||0) > 0){ soilCost = soilVolumeM3 * PRICING.soilPerM3; }
      else if ((PRICING.soilDensityTPerM3||0) > 0 && (PRICING.soilCostPerTonne||0) > 0){ var soilTonnes = soilVolumeM3 * PRICING.soilDensityTPerM3; unitsInfo.tonnes = soilTonnes; soilCost = soilTonnes * PRICING.soilCostPerTonne; }
      if (soilCost>0){ breakdown.components.push({ name:'Formwork and Prep (Soil)', area: soilVolumeM3, cost: soilCost, _units: unitsInfo }); breakdown.totalCost += soilCost; }
    }
    return breakdown;
  }
  function renderPricingBreakdown(){
    var breakdown = calculatePricing();
    var roomPricingDiv = document.getElementById('room-pricing');
    if (roomPricingDiv){
      roomPricingDiv.innerHTML='';
      if (breakdown.rooms.length===0){ roomPricingDiv.innerHTML = '<div class="pricing-item"><span class="pricing-item-name">No rooms</span><span class="pricing-item-cost">$0</span></div>'; }
      else {
        for (var i=0;i<breakdown.rooms.length;i++){
          var room = breakdown.rooms[i];
          var itemDiv = document.createElement('div');
          itemDiv.className = 'pricing-item';
          itemDiv.innerHTML = '<span class="pricing-item-name">' + room.name + ' (' + room.area.toFixed(1) + 'm²)</span>' + '<span class="pricing-item-cost">' + formatCurrency(room.cost) + '</span>';
          roomPricingDiv.appendChild(itemDiv);
        }
      }
    }
    var concreteNames = ['Concrete Slab (incl. reinforcement)', 'Formwork and Prep (Soil)'];
    var concreteItems = []; var otherComponents = [];
    for (var ci=0; ci<breakdown.components.length; ci++){
      var comp = breakdown.components[ci]; if (concreteNames.indexOf(comp.name) !== -1) concreteItems.push(comp); else otherComponents.push(comp);
    }
    var componentPricingDiv = document.getElementById('component-pricing');
    if (componentPricingDiv){
      componentPricingDiv.innerHTML = '';
      if (otherComponents.length === 0){ componentPricingDiv.innerHTML = '<div class="pricing-item"><span class="pricing-item-name">No additional components</span><span class="pricing-item-cost">$0</span></div>'; }
      else {
        for (var i2=0;i2<otherComponents.length;i2++){
          var component = otherComponents[i2];
          var itemDiv2 = document.createElement('div'); itemDiv2.className='pricing-item';
          var units='m²'; var qty=component.area;
          if (component._units && typeof component._units.units==='number'){ qty=component._units.units; units='units'; }
          else if (component._units && typeof component._units.volumeM3==='number'){ qty=component._units.volumeM3; units = 'm³' + (typeof component._units.tonnes==='number' ? ' ~ ' + component._units.tonnes.toFixed(2) + ' t' : ''); }
          itemDiv2.innerHTML = '<span class="pricing-item-name">' + component.name + ' (' + qty.toFixed(2) + units + ')</span>' + '<span class="pricing-item-cost">' + formatCurrency(component.cost) + '</span>';
          componentPricingDiv.appendChild(itemDiv2);
        }
      }
    }
    var concretePricingDiv = document.getElementById('concrete-pricing');
    if (concretePricingDiv){
      concretePricingDiv.innerHTML='';
      var concreteSectionEl = concretePricingDiv.parentElement;
      if (concreteItems.length === 0){ if(concreteSectionEl) concreteSectionEl.style.display='none'; }
      else {
        if(concreteSectionEl) concreteSectionEl.style.display='';
        for (var j=0;j<concreteItems.length;j++){
          var citem = concreteItems[j];
          var cdiv = document.createElement('div'); cdiv.className='pricing-item';
          var cunits='m²'; var cqty=citem.area;
          if (citem._units && typeof citem._units.volumeM3==='number'){ cqty=citem._units.volumeM3; cunits = 'm³' + (typeof citem._units.tonnes==='number' ? ' ~ ' + citem._units.tonnes.toFixed(2) + ' t' : ''); }
          cdiv.innerHTML = '<span class="pricing-item-name">' + citem.name + ' (' + cqty.toFixed(2) + cunits + ')</span>' + '<span class="pricing-item-cost">' + formatCurrency(citem.cost) + '</span>';
          concretePricingDiv.appendChild(cdiv);
        }
      }
    }
    var totalPricingDiv = document.getElementById('total-pricing');
    if (totalPricingDiv){
      totalPricingDiv.innerHTML = '<div class="pricing-item">' + '<span class="pricing-item-name">Total Project Cost</span>' + '<span class="pricing-item-cost">' + formatCurrency(breakdown.totalCost) + '</span>' + '</div>';
    }
  }
  window.showPricing = function(){
    var modal = document.getElementById('pricing-modal'); if (!modal) return;
    var existingDropdown = document.getElementById('roof-type-dropdown'); if (existingDropdown) existingDropdown.style.display = 'none';
    var slabMmEl = document.getElementById('pricing-slab-mm');
    var soilM3El = document.getElementById('pricing-soil-per-m3');
    if (slabMmEl) slabMmEl.value = Math.round(((window.PRICING && PRICING.slabThicknessM) || 0.1) * 1000);
    if (soilM3El) soilM3El.value = Math.round((window.PRICING && (PRICING.soilPerM3 || (PRICING.soilCostPerTonne && PRICING.soilDensityTPerM3 ? PRICING.soilCostPerTonne * PRICING.soilDensityTPerM3 : 600))));
    var applyBtn = document.getElementById('pricing-apply');
    if (applyBtn) applyBtn.onclick = function(){
      var mm = parseFloat(slabMmEl && slabMmEl.value) || 100;
      var perM3 = parseFloat(soilM3El && soilM3El.value) || 600;
      if (window.PRICING){
        PRICING.slabThicknessM = Math.max(0.05, Math.min(0.3, mm / 1000));
        PRICING.soilPerM3 = Math.max(0, perM3);
        PRICING.soilCostPerTonne = 0;
      }
      renderPricingBreakdown();
    };
    renderPricingBreakdown();
    modal.style.display = 'block';
  };
  window.hidePricing = function(){
    var modal = document.getElementById('pricing-modal'); if (modal) modal.style.display = 'none';
    var existingDropdown = document.getElementById('roof-type-dropdown'); if (existingDropdown) existingDropdown.style.display = 'block';
  };
})();
