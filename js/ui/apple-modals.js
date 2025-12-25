/**
 * Apple-Styled Modal System
 * Replaces browser prompt/confirm/alert with custom styled modals
 */

(function() {
  'use strict';

  // Input Modal (replaces prompt)
  window.showApplePrompt = function(title, defaultValue, callback) {
    var modal = document.getElementById('apple-input-modal');
    var titleEl = document.getElementById('apple-input-title');
    var input = document.getElementById('apple-input-field');
    var cancelBtn = document.getElementById('apple-input-cancel');
    var confirmBtn = document.getElementById('apple-input-confirm');

    titleEl.textContent = title || 'Enter Value';
    input.value = defaultValue || '';
    modal.style.display = 'flex';

    // Focus input after animation
    setTimeout(function() {
      input.focus();
      input.select();
    }, 100);

    function close(value) {
      modal.style.display = 'none';
      cancelBtn.onclick = null;
      confirmBtn.onclick = null;
      input.onkeydown = null;
      if (callback) callback(value);
    }

    cancelBtn.onclick = function() {
      close(null);
    };

    confirmBtn.onclick = function() {
      var value = input.value.trim();
      if (value) {
        close(value);
      }
    };

    input.onkeydown = function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var value = input.value.trim();
        if (value) {
          close(value);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close(null);
      }
    };
  };

  // Confirm Modal (replaces confirm)
  window.showAppleConfirm = function(title, message, onConfirm, onCancel) {
    var modal = document.getElementById('apple-confirm-modal');
    var titleEl = document.getElementById('apple-confirm-title');
    var messageEl = document.getElementById('apple-confirm-message');
    var cancelBtn = document.getElementById('apple-confirm-cancel');
    var okBtn = document.getElementById('apple-confirm-ok');

    titleEl.textContent = title || 'Confirm Action';
    messageEl.textContent = message || 'Are you sure?';
    modal.style.display = 'flex';

    // Focus OK button after animation
    setTimeout(function() {
      okBtn.focus();
    }, 100);

    function close(confirmed) {
      modal.style.display = 'none';
      cancelBtn.onclick = null;
      okBtn.onclick = null;
      document.onkeydown = null;
      if (confirmed && onConfirm) {
        onConfirm();
      } else if (!confirmed && onCancel) {
        onCancel();
      }
    }

    cancelBtn.onclick = function() {
      close(false);
    };

    okBtn.onclick = function() {
      close(true);
    };

    document.onkeydown = function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        close(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close(false);
      }
    };
  };

  // Alert Modal (replaces alert) - uses confirm modal with only OK button
  window.showAppleAlert = function(title, message, callback) {
    var modal = document.getElementById('apple-confirm-modal');
    var titleEl = document.getElementById('apple-confirm-title');
    var messageEl = document.getElementById('apple-confirm-message');
    var cancelBtn = document.getElementById('apple-confirm-cancel');
    var okBtn = document.getElementById('apple-confirm-ok');

    titleEl.textContent = title || 'Alert';
    messageEl.textContent = message || '';
    cancelBtn.style.display = 'none'; // Hide cancel button for alerts
    okBtn.textContent = 'OK';
    okBtn.className = 'primary'; // Change to primary style
    modal.style.display = 'flex';

    setTimeout(function() {
      okBtn.focus();
    }, 100);

    function close() {
      modal.style.display = 'none';
      okBtn.onclick = null;
      document.onkeydown = null;
      cancelBtn.style.display = ''; // Restore cancel button
      okBtn.textContent = 'Confirm';
      okBtn.className = 'danger'; // Restore danger style
      if (callback) callback();
    }

    okBtn.onclick = function() {
      close();
    };

    document.onkeydown = function(e) {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
  };

  // Contact Form Modal (multi-field form)
  window.showAppleContactForm = function(title, contact, callback) {
    var modal = document.getElementById('apple-contact-modal');
    var titleEl = document.getElementById('apple-contact-title');
    var nameInput = document.getElementById('apple-contact-name');
    var companyInput = document.getElementById('apple-contact-company');
    var phoneInput = document.getElementById('apple-contact-phone');
    var emailInput = document.getElementById('apple-contact-email');
    var licenseInput = document.getElementById('apple-contact-license');
    var cancelBtn = document.getElementById('apple-contact-cancel');
    var saveBtn = document.getElementById('apple-contact-save');

    titleEl.textContent = title || 'Edit Contact';
    nameInput.value = contact.name || '';
    companyInput.value = contact.company || '';
    phoneInput.value = contact.phone || '';
    emailInput.value = contact.email || '';
    licenseInput.value = contact.license || '';
    modal.style.display = 'flex';

    setTimeout(function() {
      nameInput.focus();
      nameInput.select();
    }, 100);

    function close(data) {
      modal.style.display = 'none';
      cancelBtn.onclick = null;
      saveBtn.onclick = null;
      nameInput.onkeydown = null;
      if (callback) callback(data);
    }

    cancelBtn.onclick = function() {
      close(null);
    };

    saveBtn.onclick = function() {
      var data = {
        name: nameInput.value.trim(),
        company: companyInput.value.trim(),
        phone: phoneInput.value.trim(),
        email: emailInput.value.trim(),
        license: licenseInput.value.trim()
      };
      if (data.name) {
        close(data);
      }
    };

    // Enter on any input saves the form
    var allInputs = [nameInput, companyInput, phoneInput, emailInput, licenseInput];
    allInputs.forEach(function(input) {
      input.onkeydown = function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          saveBtn.click();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          close(null);
        }
      };
    });
  };

})();
