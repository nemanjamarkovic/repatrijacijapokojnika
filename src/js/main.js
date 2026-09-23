(function () {
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("site-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", open ? "false" : "true");
      nav.classList.toggle("is-open", !open);
    });
  }

  document.querySelectorAll(".faq-item button").forEach(function (button) {
    button.addEventListener("click", function () {
      var expanded = button.getAttribute("aria-expanded") === "true";
      var panel = document.getElementById(button.getAttribute("aria-controls"));
      button.setAttribute("aria-expanded", expanded ? "false" : "true");
      if (panel) panel.hidden = expanded;
    });
  });

  var form = document.querySelector(".enquiry-form");
  if (!form) return;
  form.addEventListener("submit", function (event) {
    var honey = form.querySelector("[name='company_website']");
    var error = form.querySelector(".form-error");
    if (honey && honey.value) {
      event.preventDefault();
      return;
    }
    if (!form.checkValidity()) {
      event.preventDefault();
      if (error) {
        error.hidden = false;
        error.textContent = "Popunite označena polja. Imejl mora imati ispravan oblik.";
      }
      var firstInvalid = form.querySelector(":invalid");
      if (firstInvalid) firstInvalid.focus();
    }
  });
})();
