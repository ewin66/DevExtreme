import $ from 'jquery';
import Class from 'core/class';
import domUtils from 'core/utils/dom';
import DefaultAdapter from 'ui/validation/default_adapter';
import ValidationEngine from 'ui/validation_engine';

import 'ui/validation_group';

var Fixture = Class.inherit({

    ctor: function() {
        ValidationEngine.initGroups();
        this.originalValidationGroupFunction = ValidationEngine.validateGroup;
    },

    createValidationGroupContainer: function(container) {
        if(container) {
            this.$groupContainer = $(container);
        }
    },

    createGroup: function(container) {
        this.createValidationGroupContainer(container);
        var group = this.$groupContainer.dxValidationGroup().dxValidationGroup('instance');

        return group;
    }
});


QUnit.testStart(function() {
    $('#qunit-fixture').html('<div id="dxValidationGroup"></div>');
});


QUnit.module('General', {
    beforeEach: function() {
        this.fixture = new Fixture();
    }
}, () => {
    QUnit.test('validator should find group after dxshown event is triggered', function(assert) {
        var $container = $('#dxValidationGroup');
        var group = this.fixture.createGroup($container);
        var $validator = $('<div>').dxValidator({
            adapter: sinon.createStubInstance(DefaultAdapter)
        });
        var validator = $validator.dxValidator('instance');
        validator.validate = sinon.spy(validator.validate);

        // act
        $validator.appendTo($container);
        domUtils.triggerShownEvent($container);
        ValidationEngine.validateGroup(group);

        // assert
        assert.ok(validator.validate.calledOnce, 'Validator should be validated as part of group');
    });
});

